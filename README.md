# Guild Tracker

Automatically tracks RuneScape 3 hiscores for your guild and shows XP gained over
the last 7 days. A GitHub Actions workflow fetches fresh data on a schedule and
commits it to this repo; a static page (hosted for free on GitHub Pages) reads
that data and renders the dashboard. No server to run, no proxy involved.

> **Upgrading from an older version of this repo?** If you previously had a
> single ever-growing `data/history.json`, you don't need to do anything by
> hand — the first time the updated `scripts/fetch-stats.js` runs, it
> automatically splits that file into individual snapshots under
> `data/snapshots/`, builds `data/manifest.json` from it, and deletes the old
> `history.json`. Just update the two files below and let the next scheduled
> (or manually triggered) run handle the rest.

## Setup (about 10 minutes, one time)

1. **Create a new GitHub repository** (public is simplest — this data isn't
   sensitive). Upload all the files in this folder, keeping the same structure:

   ```
   guild-tracker/
     index.html
     players.json
     data/snapshots/       (auto-created and populated by the workflow)
     data/manifest.json    (auto-created by the workflow)
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
   `data/snapshots/` will have one file in it and `data/manifest.json` will
   list it.

5. **Visit your Pages URL.** You'll see current stats immediately. Weekly XP
   gained will show `0` until there's at least one snapshot from roughly a
   week ago — it fills in automatically as the scheduled runs accumulate.

## Adding or removing players

There are now two sources for who gets tracked, merged together automatically
by the fetch script:

1. **`players.json`** — a manual list, for anyone you want tracked without
   them needing a site account (e.g. yourself, before you'd built any of
   this). Edit it directly:

   ```json
   [
     "Ottomantric",
     "Ghrimhex1254",
     "NewGuildMember"
   ]
   ```

2. **Approved site members** — automatic. When an admin approves someone's
   account on the Admin tab, their RSN is added to a small public Firestore
   document (`publicRoster/roster`) that the fetch script reads on every run
   and merges with `players.json`. Declining, removing a member, or manually
   moving someone back out of `approved` status removes their RSN from that
   list the same way. No repo edits needed for this path at all — the next
   scheduled run (within 2 hours) just starts including them.

Duplicates between the two lists are harmless — they're merged into a single
set before fetching.

If you ever change Firebase projects, update `FIREBASE_PROJECT_ID` at the top
of `scripts/fetch-stats.js` to match — it needs to know which project's
`publicRoster` document to read. This is safe to have in plain sight in the
repo; it's the same project ID that's already visible in `index.html`'s
`firebaseConfig`, not a secret.

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

       match /forumPosts/{postId} {
         allow read: if true;
         allow create: if isApproved() && request.resource.data.authorUid == request.auth.uid;
         allow update: if isApproved();
         allow delete: if isAdmin() || (isApproved() && resource.data.authorUid == request.auth.uid);

         match /comments/{commentId} {
           allow read: if true;
           allow create: if isApproved() && request.resource.data.authorUid == request.auth.uid;
           allow delete: if isAdmin() || (isApproved() && resource.data.authorUid == request.auth.uid);
         }
       }

       match /publicRoster/{docId} {
         allow read: if true;
         allow write: if isAdmin();
       }

       match /tradePosts/{tradeId} {
         allow read: if true;
         allow create: if isApproved() && request.resource.data.authorUid == request.auth.uid;
         allow update: if isApproved();
         allow delete: if isAdmin() || (isApproved() && resource.data.authorUid == request.auth.uid);

         match /comments/{commentId} {
           allow read: if true;
           allow create: if isApproved() && request.resource.data.authorUid == request.auth.uid;
           allow delete: if isAdmin() || (isApproved() && resource.data.authorUid == request.auth.uid);
         }
       }
     }
   }
   ```

   The forum follows the same pattern as events: anyone can read posts and
   replies, but only approved members can create them. `update` on a post is
   left open to any approved member because that's how liking/disliking
   works (it patches a `votes` map field on the post) — same trust model as
   events, where any approved member can already edit or remove any event.
   Deleting a post or reply is limited to its author or an admin.

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

An **Admin** tab appears in the top nav automatically for anyone signed in
with `role: admin` — it's hidden from everyone else. It has two panels:
**Pending requests** (Approve/Decline, same as before) and **All members**,
a table of every account with buttons to approve/decline their status,
toggle admin access on or off, or remove their membership record entirely.
Day-to-day moderation should never need the Firebase console after the
bootstrap step below — the one thing that still needs a manual Firestore
edit is turning your *own* first account into an admin, since nobody can
grant that from inside the site before at least one admin exists.

To make someone else an admin going forward, just sign in as an existing
admin, go to the Admin tab, find them in the "All members" table, and click
**Make admin**. Removing a member's record (the "Remove" button) doesn't
delete their Firebase Authentication login — it only revokes their access to
gated features on the site. If you want to prevent them from signing in at
all, that's in **Authentication -> Users** in the Firebase console, where
you can disable or delete the account directly.

## Notes

- The page now has tabs: **Home** (about blurb, total-level leaderboard,
  account sign-up and membership status), **Player stats** (the weekly XP
  dashboard), **Calendar** (events/RSVP), **Forum** (posts, likes/dislikes,
  replies), and **Admin** (visible only to admins). Switching tabs updates
  the URL hash (`#home`, `#stats`, `#calendar`, `#forum`, `#admin`) so you
  can link directly to one.
- Anyone can read forum posts and replies without an account; only approved
  members can post, vote, or reply. A post's author (or any admin) can
  delete it; the same goes for individual replies.
- Liking and disliking are mutually exclusive per person per post — clicking
  the option you already picked removes your vote instead of adding a
  second one.
- The **Trading** tab works the same way as the forum (public read, approved
  members can list/reply/moderate), but each listing also looks up an item
  thumbnail from the RuneScape Wiki's public API by name and stores the
  result — so images don't need to be fetched again on every page view. If a
  name doesn't match a wiki page (or the lookup fails for any reason), the
  listing still posts fine, it just shows the item name without a picture —
  a missing image is never a blocking error.
- The "About the guild" text on the Home tab is placeholder copy — edit the
  `<div class="about-panel">` block in `index.html` to describe your actual
  guild.
- Anyone can create an account, but new accounts start `pending` and can't
  RSVP or add events until an admin approves them on the Home tab (see
  "Setting up member accounts" above). Viewing stats and the calendar stays
  public either way — no login needed just to look.
- Approving someone on the Admin tab automatically adds their RSN to the
  tracked roster (see "Adding or removing players" above) — no manual
  `players.json` edit needed for members who signed up through the site.
- Snapshots older than 30 days are deleted automatically — both the file in
  `data/snapshots/` and its entry in `data/manifest.json` — on every
  scheduled run. Change `RETENTION_DAYS` at the top of
  `scripts/fetch-stats.js` if you want to keep more or less history.
- If a player's name has unusual characters or spaces, the script URL-encodes
  it automatically — just type the name as it appears in-game.
- If someone's profile is private or the name is misspelled, that player is
  skipped for that run (logged in the workflow's output) rather than failing
  the whole update.
