import fs from 'fs/promises';

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
  const players = JSON.parse(await fs.readFile(PLAYERS_PATH, 'utf-8'));

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
