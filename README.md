# Guild Tracker

Automatically tracks RuneScape 3 hiscores for your guild and shows XP gained over
the last 7 days. A GitHub Actions workflow fetches fresh data on a schedule and
commits it to this repo; a static page (hosted for free on GitHub Pages) reads
that data and renders the dashboard. No server to run, no proxy involved.

## Setup (about 10 minutes, one time)

1. **Create a new GitHub repository** (public is simplest — this data isn't
   sensitive). Upload all the files in this folder, keeping the same structure:

   ```
   guild-tracker/
     index.html
     players.json
     data/history.json
     scripts/fetch-stats.js
     .github/workflows/update-stats.yml
   ```

2. **Allow the workflow to commit back to the repo.**
   Go to `Settings -> Actions -> General -> Workflow permissions`, choose
   "Read and write permissions", and save. Without this, the workflow will
   fetch data successfully but fail to save it.

3. **Turn on GitHub Pages.**
   Go to `Settings -> Pages`, set "Source" to "Deploy from a branch", pick
   `main` and the `/ (root)` folder, and save. GitHub will give you a URL like
   `https://yourname.github.io/guild-tracker/`.

4. **Run the workflow once manually** to generate the first snapshot, instead
   of waiting for the schedule.
   Go to the `Actions` tab -> "Update guild stats" (left sidebar) -> "Run
   workflow" button -> "Run workflow". After it finishes (a minute or so),
   `data/history.json` will have one entry.

5. **Visit your Pages URL.** You'll see current stats immediately. Weekly XP
   gained will show `0` until there's at least one snapshot from roughly a
   week ago — it fills in automatically as the scheduled runs accumulate.

## Adding or removing players

Edit `players.json` — it's just a plain list of RuneScape display names:

```json
[
  "Ottomantric",
  "Ghrimhex1254",
  "NewGuildMember"
]
```

Commit the change (or edit it directly in the GitHub web UI), and the next
scheduled run — or a manually triggered one — will pick it up.

## Changing how often it updates

Edit the `cron` line in `.github/workflows/update-stats.yml`. It's currently
set to every 2 hours (`0 */2 * * *`). GitHub Actions cron schedules can drift
by a few minutes and are disabled automatically on repos with no activity for
60 days — pushing any commit re-enables it.

## Setting up member accounts and the events calendar

The stats dashboard is read-only, so it works fine off a plain JSON file.
RSVPing and adding events need to be restricted to approved guild members, and
someone needs a way to review new sign-ups — a static site can't do any of
that alone, so this uses Firebase (a free backend you talk to directly from
the page; no server of your own to run).

1. Go to [console.firebase.google.com](https://console.firebase.google.com),
   sign in with any Google account, and click "Create a project." Give it any
   name — no credit card is required for what this uses.
2. In the project, go to **Build -> Firestore Database -> Create database**.
   Choose "Start in test mode" for now (we'll lock it down with the rules
   below) and pick any region close to your group.
3. Go to **Project settings** (gear icon) -> scroll to "Your apps" -> click
   the `</>` (web) icon -> register an app (no need to check "also set up
   Firebase Hosting"). It'll show you a `firebaseConfig` object like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```

4. Open `index.html` in this repo, find the `firebaseConfig` object near the
   bottom (search for `PASTE_ME`), and replace it with your actual values.
   Commit the change.
5. Go to **Build -> Authentication** (use the "Search for products" box at
   the top of the sidebar if it's not listed yet — it only appears once
   you've opened it the first time). Click **Get started**, go to the
   **Sign-in method** tab, and enable **Email/Password**.
6. Go to **Firestore Database -> Rules** and replace the default rules with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {

       function signedIn() { return request.auth != null; }
       function memberDoc() {
         return get(/databases/$(database)/documents/members/$(request.auth.uid));
       }
       function isApproved() { return signedIn() && memberDoc().data.status == 'approved'; }
       function isAdmin() { return signedIn() && memberDoc().data.role == 'admin'; }

       match /members/{uid} {
         allow create: if signedIn() && request.auth.uid == uid
           && request.resource.data.status == 'pending'
           && request.resource.data.role == 'member';
         allow read: if signedIn() && (request.auth.uid == uid || isAdmin());
         allow update, delete: if isAdmin();
       }

       match /events/{eventId} {
         allow read: if true;
         allow create, update, delete: if isApproved();
       }
     }
   }
   ```

   A few things this setup is doing on purpose:
   - Anyone can create their own `members` document (that's what happens
     automatically when someone signs up), but the rule forces new accounts
     to start as `status: 'pending'` and `role: 'member'` — a signed-up user
     cannot write their own account in as already-approved or as an admin,
     even by tampering with the page's JavaScript, because Firestore itself
     rejects the write.
   - Only an admin can change `status` or `role` afterward (that's the
     Approve/Decline buttons on the Home tab).
   - Events are publicly readable (anyone can see the calendar) but only
     approved members can create events or RSVP.

7. **Bootstrap your own admin account** (one-time, manual):
   - Visit your Pages site and use "Create account" to sign up normally —
     you'll land in `pending` status like anyone else.
   - In Firebase, go to **Firestore Database -> Data**, open the `members`
     collection, and click the document with your `uid` (match it by the
     `email` field).
   - Edit two fields on that document: set `status` to `approved` and `role`
     to `admin`. Save.
   - Refresh the site and sign in again — you should see "(admin)" next to
     your name and a "Pending member requests" list on the Home tab.
   - From here on, approving everyone else is just clicking "Approve" in
     that list — no more manual Firestore editing needed, except to promote
     additional admins the same way you bootstrapped yourself.

8. Refresh your GitHub Pages site. The "Accounts not connected yet" message
   should disappear.

## Managing admins

To make someone else an admin, open their document under **Firestore
Database -> Data -> members** and set `role` to `admin` (they still need
`status: approved` too, which they'll already have if you approved their
sign-up). To remove admin access, change `role` back to `member`.

Approving or declining a sign-up doesn't touch their login (that's a separate
Firebase Authentication record) — it only controls what they can do on the
site. If you want to fully remove someone's ability to even sign in again,
that's in **Authentication -> Users**, where you can disable or delete the
account.

## Notes

- The page now has three tabs: **Home** (about blurb, total-level leaderboard,
  account sign-up and membership status), **Player stats** (the weekly XP
  dashboard), and **Calendar** (events/RSVP). Switching tabs updates the URL
  hash (`#home`, `#stats`, `#calendar`) so you can link directly to one.
- The "About the guild" text on the Home tab is placeholder copy — edit the
  `<div class="about-panel">` block in `index.html` to describe your actual
  guild.
- Anyone can create an account, but new accounts start `pending` and can't
  RSVP or add events until an admin approves them on the Home tab (see
  "Setting up member accounts" above). Viewing stats and the calendar stays
  public either way — no login needed just to look.
- Approving or declining a sign-up doesn't automatically touch
  `players.json` — you still add their RSN there yourself if you want their
  stats tracked.
- History is capped at 400 snapshots in `scripts/fetch-stats.js` (roughly
  100 days at a 4x/day cadence) to keep the file small. Raise `MAX_SNAPSHOTS`
  if you want to keep more.
- If a player's name has unusual characters or spaces, the script URL-encodes
  it automatically — just type the name as it appears in-game.
- If someone's profile is private or the name is misspelled, that player is
  skipped for that run (logged in the workflow's output) rather than failing
  the whole update.
