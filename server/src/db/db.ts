import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { serversData } from '../data.js';

const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../game.db', import.meta.url));

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nickname TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dungeon_progress (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id),
  best_floor INTEGER NOT NULL DEFAULT 0,
  day INTEGER NOT NULL DEFAULT 0, entries_used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL,
  name TEXT NOT NULL, leader_id INTEGER NOT NULL REFERENCES characters(id),
  exp INTEGER NOT NULL DEFAULT 0, notice TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  UNIQUE (server_id, name)
);
CREATE TABLE IF NOT EXISTS guild_members (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id),
  guild_id INTEGER NOT NULL REFERENCES guilds(id),
  joined_at INTEGER NOT NULL, contribution INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guild_donations (
  character_id INTEGER NOT NULL REFERENCES characters(id), day INTEGER NOT NULL,
  value REAL NOT NULL DEFAULT 0, PRIMARY KEY (character_id, day)
);
CREATE TABLE IF NOT EXISTS guild_boss (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL REFERENCES guilds(id),
  tier TEXT NOT NULL, hp_max INTEGER NOT NULL, hp INTEGER NOT NULL,
  started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS guild_boss_part (
  boss_id INTEGER NOT NULL REFERENCES guild_boss(id),
  character_id INTEGER NOT NULL REFERENCES characters(id),
  damage INTEGER NOT NULL DEFAULT 0, attacks INTEGER NOT NULL DEFAULT 0,
  day INTEGER NOT NULL DEFAULT 0, day_attacks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (boss_id, character_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  server_id INTEGER NOT NULL REFERENCES servers(id),
  race TEXT NOT NULL, territory_name TEXT NOT NULL,
  territory_level INTEGER NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (user_id, server_id)
);
CREATE TABLE IF NOT EXISTS resources (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id),
  food INTEGER NOT NULL, wood INTEGER NOT NULL, stone INTEGER NOT NULL,
  iron INTEGER NOT NULL, gold INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  type TEXT NOT NULL, level INTEGER NOT NULL, upgrade_finish_at INTEGER,
  position_x INTEGER NOT NULL, position_y INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS unit_stock (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  unit_id TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (character_id, unit_id)
);
CREATE TABLE IF NOT EXISTS map_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  resource TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, remaining INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS expeditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  resource TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, dist REAL NOT NULL,
  troops INTEGER NOT NULL, yield INTEGER NOT NULL,
  start_at INTEGER NOT NULL, finish_at INTEGER NOT NULL, collected INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS train_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  unit_id TEXT NOT NULL, amount INTEGER NOT NULL,
  start_at INTEGER NOT NULL, finish_at INTEGER NOT NULL, collected INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS battle_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attacker_id INTEGER NOT NULL REFERENCES characters(id),
  defender_id INTEGER, defender_label TEXT,
  a_cp REAL NOT NULL, b_cp REAL NOT NULL, winner TEXT NOT NULL,
  a_losses_json TEXT NOT NULL, b_losses_json TEXT NOT NULL,
  seed INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  type TEXT NOT NULL, grade TEXT NOT NULL, power REAL NOT NULL,
  equipped INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS craft_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  type TEXT NOT NULL, start_at INTEGER NOT NULL, finish_at INTEGER NOT NULL,
  collected INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  key TEXT NOT NULL, params TEXT NOT NULL, created_at INTEGER NOT NULL
);
`);

const charCols = (db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map(
  (c) => c.name,
);
if (!charCols.includes('upgrade_to'))
  db.exec('ALTER TABLE characters ADD COLUMN upgrade_to INTEGER');
if (!charCols.includes('upgrade_finish_at'))
  db.exec('ALTER TABLE characters ADD COLUMN upgrade_finish_at INTEGER');

const bldCols = (db.prepare('PRAGMA table_info(buildings)').all() as { name: string }[]).map(
  (c) => c.name,
);
if (!bldCols.includes('levelup_to')) db.exec('ALTER TABLE buildings ADD COLUMN levelup_to INTEGER');
if (!bldCols.includes('levelup_finish_at'))
  db.exec('ALTER TABLE buildings ADD COLUMN levelup_finish_at INTEGER');

const eqCols = (db.prepare('PRAGMA table_info(equipment)').all() as { name: string }[]).map(
  (c) => c.name,
);
if (!eqCols.includes('enhance'))
  db.exec('ALTER TABLE equipment ADD COLUMN enhance INTEGER NOT NULL DEFAULT 0');

if (!charCols.includes('last_attack_at'))
  db.exec('ALTER TABLE characters ADD COLUMN last_attack_at INTEGER');
if (!charCols.includes('protection_until'))
  db.exec('ALTER TABLE characters ADD COLUMN protection_until INTEGER');

const upsertServer = db.prepare(
  'INSERT INTO servers (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name',
);
for (const s of serversData.servers) upsertServer.run(s.id, s.name, Date.now());

db.exec(`
CREATE TABLE IF NOT EXISTS quest_progress (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  quest_id TEXT NOT NULL, period TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, quest_id, period)
);
CREATE TABLE IF NOT EXISTS research (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  tech_id TEXT NOT NULL, level INTEGER NOT NULL,
  PRIMARY KEY (character_id, tech_id)
);
CREATE TABLE IF NOT EXISTS research_job (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id),
  tech_id TEXT NOT NULL, to_level INTEGER NOT NULL, finish_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS market_daily (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  day INTEGER NOT NULL, volume REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, day)
);
`);

const charCols2 = (db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map(
  (c) => c.name,
);
const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(
  (c) => c.name,
);
for (const [name, type] of [
  ['login_id', 'TEXT'],
  ['pw_hash', 'TEXT'],
  ['pw_salt', 'TEXT'],
  ['is_admin', 'INTEGER'],
] as const) {
  if (!userCols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_id ON users(login_id)');

for (const [name, type] of [
  ['last_seen_at', 'INTEGER'],
  ['seen_res', 'TEXT'],
  ['attendance_day', 'INTEGER'],
  ['attendance_streak', 'INTEGER'],
  ['next_raid_at', 'INTEGER'],
  ['speedup_sec', 'INTEGER NOT NULL DEFAULT 0'],
] as const) {
  if (!charCols2.includes(name)) db.exec(`ALTER TABLE characters ADD COLUMN ${name} ${type}`);
}

/** 단순 트랜잭션 헬퍼 */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
