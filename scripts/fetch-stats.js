import fs from 'fs/promises';

// Matches the projectId in index.html's firebaseConfig — update if you ever
// switch Firebase projects.
const FIREBASE_PROJECT_ID = 'guild-tracker-9ff50';

const SKILL_ORDER = [
  "Overall", "Attack", "Defence", "Strength", "Constitution", "Ranged", "Prayer", "Magic",
  "Cooking", "Woodcutting", "Fletching", "Fishing", "Firemaking", "Crafting", "Smithing",
  "Mining", "Herblore", "Agility", "Thieving", "Slayer", "Farming", "Runecrafting",
  "Hunter", "Construction", "Summoning", "Dungeoneering", "Divination", "Invention",
  "Archaeology", "Necromancy"
];

const SNAPSHOTS_DIR = new URL('../data/snapshots/', import.meta.url);
const MANIFEST_PATH = new URL('../data/manifest.json', import.meta.url);
const LEGACY_HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const PLAYERS_PATH = new URL('../players.json', import.meta.url);

// Snapshots older than this are deleted (file + manifest entry) on every run.
const RETENTION_DAYS = 30;

// Firestore timestamps/filenames can't contain colons or periods on some
// filesystems, so snapshot filenames swap those for hyphens. The manifest
// always stores the original ISO timestamp string; the filename is derived
// from it the same way here and in index.html.
function filenameForTimestamp(ts) {
  return ts.replace(/[:.]/g, '-') + '.json';
}

// Reads the publicly-readable `publicRoster/roster` Firestore document —
// no API key or auth needed since the security rules mark it public-read.
// Returns [] on any failure so a Firestore hiccup never blocks the whole run.
async function fetchApprovedRoster() {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/publicRoster/roster`;
  try {
    const res = await fetch(url);
    if (res.status === 404) return []; // no one approved yet, or doc not created
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const values = data.fields?.rsns?.arrayValue?.values || [];
    return values.map((v) => v.stringValue).filter(Boolean);
  } catch (err) {
    console.error(`could not fetch approved-member roster from Firestore: ${err.message}`);
    return [];
  }
}

async function fetchPlayerStats(name) {
  const url = `https://secure.runescape.com/m=hiscore/index_lite.ws?player=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'guild-tracker (github actions bot)' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = (await res.text()).trim();
  if (!text || text.startsWith('<')) {
    throw new Error('player not found or hiscores unavailable');
  }
  const lines = text.split('\n');
  const skills = {};
  for (let i = 0; i < SKILL_ORDER.length && i < lines.length; i++) {
    const parts = lines[i].split(',').map(Number);
    skills[SKILL_ORDER[i]] = {
      rank: parts[0],
      level: parts[1],
      xp: parts.length > 2 ? parts[2] : null
    };
  }
  return skills;
}

// One-time migration: if manifest.json doesn't exist yet but a legacy
// history.json does, split it into individual snapshot files and build the
// manifest from it, then remove the old file. Safe to run every time —
// after the first run, manifest.json exists and this is skipped entirely.
async function migrateLegacyHistoryIfNeeded() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf-8'));
  } catch {
    // no manifest yet — fall through to check for a legacy file below
  }

  let legacyHistory = [];
  try {
    legacyHistory = JSON.parse(await fs.readFile(LEGACY_HISTORY_PATH, 'utf-8'));
  } catch {
    return []; // no manifest and no legacy file — starting completely fresh
  }

  const manifest = [];
  for (const snap of legacyHistory) {
    if (!snap || !snap.timestamp) continue;
    const filename = filenameForTimestamp(snap.timestamp);
    await fs.writeFile(new URL(filename, SNAPSHOTS_DIR), JSON.stringify(snap, null, 2));
    manifest.push(snap.timestamp);
  }
  manifest.sort();

  try {
    await fs.unlink(LEGACY_HISTORY_PATH);
  } catch {
    // already gone, fine
  }

  console.log(`migrated ${manifest.length} snapshot(s) from history.json into data/snapshots/`);
  return manifest;
}

async function pruneOldSnapshots(manifest) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = [];
  for (const ts of manifest) {
    if (new Date(ts).getTime() >= cutoff) {
      keep.push(ts);
    } else {
      try {
        await fs.unlink(new URL(filenameForTimestamp(ts), SNAPSHOTS_DIR));
      } catch {
        // already gone, fine
      }
    }
  }
  const removed = manifest.length - keep.length;
  if (removed > 0) console.log(`pruned ${removed} snapshot(s) older than ${RETENTION_DAYS} days`);
  return keep;
}

async function main() {
  const manualPlayers = JSON.parse(await fs.readFile(PLAYERS_PATH, 'utf-8'));
  const rosterPlayers = await fetchApprovedRoster();
  const players = Array.from(new Set([...manualPlayers, ...rosterPlayers]));
  console.log(`tracking ${players.length} player(s): ${manualPlayers.length} from players.json, ${rosterPlayers.length} from approved site members`);

  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  let manifest = await migrateLegacyHistoryIfNeeded();

  const snapshot = { timestamp: new Date().toISOString(), players: {} };
  const errors = [];

  for (const name of players) {
    try {
      snapshot.players[name] = await fetchPlayerStats(name);
      console.log(`fetched ${name}`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      console.error(`failed to fetch ${name}: ${err.message}`);
    }
    // Small delay between requests to be polite to Jagex's servers.
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (Object.keys(snapshot.players).length === 0) {
    console.error('No players fetched successfully, not writing a snapshot.');
    process.exit(1);
  }

  const filename = filenameForTimestamp(snapshot.timestamp);
  await fs.writeFile(new URL(filename, SNAPSHOTS_DIR), JSON.stringify(snapshot, null, 2));
  manifest.push(snapshot.timestamp);
  manifest.sort();

  manifest = await pruneOldSnapshots(manifest);

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`saved ${filename} — manifest now tracks ${manifest.length} snapshot(s) over the last ${RETENTION_DAYS} days`);

  if (errors.length) {
    console.error(`completed with ${errors.length} error(s):\n${errors.join('\n')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

