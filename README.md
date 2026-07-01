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
set to every 6 hours (`0 */6 * * *`). GitHub Actions cron schedules can drift
by a few minutes and are disabled automatically on repos with no activity for
60 days — pushing any commit re-enables it.

## Setting up the events calendar

The stats dashboard is read-only, so it works fine off a plain JSON file. RSVPs
need to be writable by anyone visiting the page, in real time — a static site
can't do that alone, so the calendar uses Firebase Firestore, a free database
you talk to directly from the page (no server of your own to run).

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
5. Back in Firebase, go to **Firestore Database -> Rules** and replace the
   default rules with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /events/{eventId} {
         allow read, write: if true;
       }
     }
   }
   ```

   This scopes open access to only the `events` collection (not your whole
   Firebase project) but doesn't require login — anyone with your Pages URL
   can add, RSVP to, or delete events. That's a reasonable trade-off for a
   small private guild page; it wouldn't be appropriate for anything public
   or sensitive.

6. Refresh your GitHub Pages site. The "Calendar not connected yet" message
   should disappear, and you should be able to add an event and RSVP.

Each person types their RSN once into the "RSVPing as" field — it's
remembered in their own browser for next time, and used to tag their RSVP.

## Notes

- History is capped at 400 snapshots in `scripts/fetch-stats.js` (roughly
  100 days at a 4x/day cadence) to keep the file small. Raise `MAX_SNAPSHOTS`
  if you want to keep more.
- If a player's name has unusual characters or spaces, the script URL-encodes
  it automatically — just type the name as it appears in-game.
- If someone's profile is private or the name is misspelled, that player is
  skipped for that run (logged in the workflow's output) rather than failing
  the whole update.
