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

## Notes

- History is capped at 400 snapshots in `scripts/fetch-stats.js` (roughly
  100 days at a 4x/day cadence) to keep the file small. Raise `MAX_SNAPSHOTS`
  if you want to keep more.
- If a player's name has unusual characters or spaces, the script URL-encodes
  it automatically — just type the name as it appears in-game.
- If someone's profile is private or the name is misspelled, that player is
  skipped for that run (logged in the workflow's output) rather than failing
  the whole update.
