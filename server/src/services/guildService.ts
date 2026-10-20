import { db, transaction } from '../db/db.js';
import { guildData, marketData } from '../data.js';
import {
  donationExp,
  guildBuff,
  guildLevel,
  maxGuildLevel,
  maxMembers,
  nextLevelExp,
  validGuildName,
} from './guildRules.js';
import { dayKey } from './questEvents.js';
import { GameError, settle } from './territoryService.js';
import { npcEnabled, recruitNpcMembers } from './npcService.js';

const RES = ['food', 'wood', 'stone', 'iron', 'gold'] as const;
type Res = (typeof RES)[number];

interface CharRow {
  id: number;
  server_id: number;
  territory_level: number;
}
interface GuildRow {
  id: number;
  server_id: number;
  name: string;
  leader_id: number;
  exp: number;
  notice: string;
}

function charRow(characterId: number): CharRow {
  return db
    .prepare('SELECT id, server_id, territory_level FROM characters WHERE id = ?')
    .get(characterId) as unknown as CharRow;
}
function myGuildId(characterId: number): number | null {
  const r = db
    .prepare('SELECT guild_id FROM guild_members WHERE character_id = ?')
    .get(characterId) as { guild_id: number } | undefined;
  return r?.guild_id ?? null;
}
function guildRow(guildId: number): GuildRow {
  return db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId) as unknown as GuildRow;
}
function memberCount(guildId: number): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?').get(guildId) as {
      n: number;
    }
  ).n;
}
function requireMyGuild(characterId: number): GuildRow {
  const id = myGuildId(characterId);
  if (id === null) throw new GameError('NOT_IN_GUILD');
  return guildRow(id);
}
function requireLeader(characterId: number): GuildRow {
  const g = requireMyGuild(characterId);
  if (g.leader_id !== characterId) throw new GameError('NOT_GUILD_LEADER', 403);
  return g;
}
function requireLevel(c: CharRow): void {
  if (c.territory_level < guildData.minTerritoryLevel) throw new GameError('GUILD_LOCKED');
}
function donatedToday(characterId: number): number {
  const r = db
    .prepare('SELECT value FROM guild_donations WHERE character_id = ? AND day = ?')
    .get(characterId, dayKey()) as { value: number } | undefined;
  return r?.value ?? 0;
}

function guildView(g: GuildRow, viewerId: number) {
  const level = guildLevel(g.exp);
  const members = db
    .prepare(
      `SELECT c.id AS characterId, u.nickname AS owner, c.territory_name AS territoryName,
              c.territory_level AS level, m.contribution
       FROM guild_members m JOIN characters c ON c.id = m.character_id JOIN users u ON u.id = c.user_id
       WHERE m.guild_id = ? ORDER BY m.contribution DESC, m.joined_at`,
    )
    .all(g.id) as unknown as {
    characterId: number;
    owner: string;
    territoryName: string;
    level: number;
    contribution: number;
  }[];
  return {
    id: g.id,
    name: g.name,
    level,
    maxLevel: maxGuildLevel(),
    exp: g.exp,
    nextExp: nextLevelExp(level),
    notice: g.notice,
    memberCount: members.length,
    maxMembers: maxMembers(level),
    isLeader: g.leader_id === viewerId,
    buff: guildBuff(level),
    members: members.map((m) => ({ ...m, isLeader: m.characterId === g.leader_id })),
  };
}

export function guildState(characterId: number) {
  settle(characterId);
  const c = charRow(characterId);
  const gid = myGuildId(characterId);
  return {
    serverNow: Date.now(),
    minLevel: guildData.minTerritoryLevel,
    locked: c.territory_level < guildData.minTerritoryLevel,
    createCost: guildData.createCost,
    nameLength: guildData.nameLength,
    noticeMaxLength: guildData.noticeMaxLength,
    donate: {
      limit: guildData.dailyDonateValueLimit,
      used: Math.round(donatedToday(characterId)),
      values: marketData.values,
      expPerValue: guildData.expPerValue,
    },
    guild: gid === null ? null : guildView(guildRow(gid), characterId),
  };
}

/** 같은 서버의 길드 목록 (경험치 순) */
export function guildList(characterId: number) {
  const c = charRow(characterId);
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.exp, u.nickname AS leader,
              (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = g.id) AS members
       FROM guilds g JOIN characters lc ON lc.id = g.leader_id JOIN users u ON u.id = lc.user_id
       WHERE g.server_id = ? ORDER BY g.exp DESC, g.id LIMIT ?`,
    )
    .all(c.server_id, guildData.listLimit) as unknown as {
    id: number;
    name: string;
    exp: number;
    leader: string;
    members: number;
  }[];
  return rows.map((r) => {
    const level = guildLevel(r.exp);
    return {
      id: r.id,
      name: r.name,
      level,
      leader: r.leader,
      members: r.members,
      maxMembers: maxMembers(level),
    };
  });
}

export function createGuild(characterId: number, rawName: unknown): void {
  settle(characterId);
  const c = charRow(characterId);
  requireLevel(c);
  if (myGuildId(characterId) !== null) throw new GameError('ALREADY_IN_GUILD');
  const name = validGuildName(rawName);
  if (!name) throw new GameError('INVALID_GUILD_NAME');
  if (db.prepare('SELECT 1 FROM guilds WHERE server_id = ? AND name = ?').get(c.server_id, name))
    throw new GameError('GUILD_NAME_TAKEN', 409);
  const res = db
    .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(guildData.createCost))
    if (res[k] < v) throw new GameError('NOT_ENOUGH_RESOURCES');
  let newGuildId = 0;
  transaction(() => {
    for (const [k, v] of Object.entries(guildData.createCost))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
    const now = Date.now();
    const info = db
      .prepare('INSERT INTO guilds (server_id, name, leader_id, created_at) VALUES (?,?,?,?)')
      .run(c.server_id, name, characterId, now);
    newGuildId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO guild_members (character_id, guild_id, joined_at) VALUES (?,?,?)').run(
      characterId,
      newGuildId,
      now,
    );
  });
  // 혼자 하는 판: 비슷한 레벨의 가상 길드원이 함께한다
  if (npcEnabled()) recruitNpcMembers(newGuildId, c.territory_level);
}

export function joinGuild(characterId: number, guildId: number): void {
  settle(characterId);
  const c = charRow(characterId);
  requireLevel(c);
  if (myGuildId(characterId) !== null) throw new GameError('ALREADY_IN_GUILD');
  const g = db
    .prepare('SELECT * FROM guilds WHERE id = ? AND server_id = ?')
    .get(Number.isInteger(guildId) ? guildId : -1, c.server_id) as unknown as GuildRow | undefined;
  if (!g) throw new GameError('GUILD_NOT_FOUND', 404);
  if (memberCount(g.id) >= maxMembers(guildLevel(g.exp))) throw new GameError('GUILD_FULL');
  db.prepare('INSERT INTO guild_members (character_id, guild_id, joined_at) VALUES (?,?,?)').run(
    characterId,
    g.id,
    Date.now(),
  );
}

export function leaveGuild(characterId: number): void {
  const g = requireMyGuild(characterId);
  if (g.leader_id === characterId && memberCount(g.id) > 1)
    throw new GameError('LEADER_MUST_TRANSFER');
  transaction(() => {
    db.prepare('DELETE FROM guild_members WHERE character_id = ?').run(characterId);
    if (g.leader_id === characterId) db.prepare('DELETE FROM guilds WHERE id = ?').run(g.id);
  });
}

export function kickMember(characterId: number, targetId: number): void {
  const g = requireLeader(characterId);
  if (targetId === characterId) throw new GameError('INVALID_TARGET');
  const t = db
    .prepare('SELECT 1 FROM guild_members WHERE character_id = ? AND guild_id = ?')
    .get(Number.isInteger(targetId) ? targetId : -1, g.id);
  if (!t) throw new GameError('INVALID_TARGET', 404);
  db.prepare('DELETE FROM guild_members WHERE character_id = ?').run(targetId);
}

export function transferLeader(characterId: number, targetId: number): void {
  const g = requireLeader(characterId);
  if (targetId === characterId) throw new GameError('INVALID_TARGET');
  const t = db
    .prepare('SELECT 1 FROM guild_members WHERE character_id = ? AND guild_id = ?')
    .get(Number.isInteger(targetId) ? targetId : -1, g.id);
  if (!t) throw new GameError('INVALID_TARGET', 404);
  db.prepare('UPDATE guilds SET leader_id = ? WHERE id = ?').run(targetId, g.id);
}

export function disbandGuild(characterId: number): void {
  const g = requireLeader(characterId);
  transaction(() => {
    db.prepare('DELETE FROM guild_members WHERE guild_id = ?').run(g.id);
    db.prepare('DELETE FROM guilds WHERE id = ?').run(g.id);
  });
}

export function setNotice(characterId: number, raw: unknown): void {
  const g = requireLeader(characterId);
  if (typeof raw !== 'string' || raw.length > guildData.noticeMaxLength)
    throw new GameError('INVALID_NOTICE');
  db.prepare('UPDATE guilds SET notice = ? WHERE id = ?').run(raw.trim(), g.id);
}

/** 기부: 자원 가치(시장 기준)를 길드 경험치/개인 기여도로 바꾼다. 하루 가치 한도가 있다. */
export function donate(characterId: number, resource: string, amount: number) {
  settle(characterId);
  const g = requireMyGuild(characterId);
  if (!RES.includes(resource as Res)) throw new GameError('INVALID_RESOURCE');
  if (!Number.isInteger(amount) || amount < 1) throw new GameError('INVALID_AMOUNT');
  const value = amount * marketData.values[resource as Res];
  if (donatedToday(characterId) + value > guildData.dailyDonateValueLimit)
    throw new GameError('DONATE_LIMIT');
  const res = db
    .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  if (res[resource] < amount) throw new GameError('NOT_ENOUGH_RESOURCES');
  const exp = donationExp(value);
  if (exp < 1) throw new GameError('INVALID_AMOUNT');
  transaction(() => {
    db.prepare(`UPDATE resources SET ${resource} = ${resource} - ? WHERE character_id = ?`).run(
      amount,
      characterId,
    );
    db.prepare(
      `INSERT INTO guild_donations (character_id, day, value) VALUES (?,?,?)
       ON CONFLICT(character_id, day) DO UPDATE SET value = value + excluded.value`,
    ).run(characterId, dayKey(), value);
    db.prepare('UPDATE guilds SET exp = exp + ? WHERE id = ?').run(exp, g.id);
    db.prepare(
      'UPDATE guild_members SET contribution = contribution + ? WHERE character_id = ?',
    ).run(exp, characterId);
  });
  return { exp };
}
