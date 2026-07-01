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

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const PLAYERS_PATH = new URL('../players.json', import.meta.url);

// Keep roughly 100 days of history at a 4x/day snapshot rate before trimming old entries.
const MAX_SNAPSHOTS = 400;

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

async function main() {
  const manualPlayers = JSON.parse(await fs.readFile(PLAYERS_PATH, 'utf-8'));
  const rosterPlayers = await fetchApprovedRoster();
  const players = Array.from(new Set([...manualPlayers, ...rosterPlayers]));
  console.log(`tracking ${players.length} player(s): ${manualPlayers.length} from players.json, ${rosterPlayers.length} from approved site members`);

  let history = [];
  try {
    history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf-8'));
  } catch {
    history = [];
  }

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

  history.push(snapshot);
  if (history.length > MAX_SNAPSHOTS) {
    history = history.slice(history.length - MAX_SNAPSHOTS);
  }

  await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`saved snapshot, history now has ${history.length} entries`);

  if (errors.length) {
    console.error(`completed with ${errors.length} error(s):\n${errors.join('\n')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
