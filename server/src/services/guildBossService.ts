import { db, transaction } from '../db/db.js';
import { guildBossData, units } from '../data.js';
import { armyCP } from './battle.js';
import { applyLosses, selectArmy, unitCP } from './battleService.js';
import { combatMultiplier } from './bonuses.js';
import { grantRandomEquipment, inventoryFull } from './equipmentGrant.js';
import type { GrantedItem } from './equipmentGrant.js';
import { guildLevel } from './guildRules.js';
import {
  bossHp,
  bossLosses,
  rollDamage,
  scaleReward,
  tierFor,
  ticketsLeft,
} from './guildBossRules.js';
import type { BossTier } from './guildBossRules.js';
import { dayKey } from './questEvents.js';
import { addSpeedup } from './speedupGrant.js';
import { GameError, characterStorageCap, settle } from './territoryService.js';

interface BossRow {
  id: number;
  guild_id: number;
  tier: string;
  hp_max: number;
  hp: number;
  started_at: number;
  ends_at: number;
  status: 'active' | 'won' | 'lost';
  finished_at: number | null;
}
interface PartRow {
  character_id: number;
  damage: number;
  attacks: number;
  day: number;
  day_attacks: number;
}

const tierById = (id: string): BossTier =>
  guildBossData.tiers.find((t) => t.id === id) ?? guildBossData.tiers[0];

/** 보유 병력 전체의 전투력 (장비/연구/길드 버프 반영) — 보스 체력 산정용 */
function memberCP(characterId: number): number {
  const ch = db.prepare('SELECT race FROM characters WHERE id = ?').get(characterId) as {
    race: string;
  };
  const mult = combatMultiplier(characterId);
  const stock = db
    .prepare('SELECT unit_id, count FROM unit_stock WHERE character_id = ?')
    .all(characterId) as unknown as { unit_id: string; count: number }[];
  return stock.reduce((sum, s) => {
    const def = units.units.find((u) => u.id === s.unit_id);
    return sum + (def ? unitCP(ch.race, def, mult) * s.count : 0);
  }, 0);
}

function myGuild(characterId: number): { id: number; leader_id: number; exp: number } {
  const g = db
    .prepare(
      'SELECT g.id, g.leader_id, g.exp FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.character_id = ?',
    )
    .get(characterId) as { id: number; leader_id: number; exp: number } | undefined;
  if (!g) throw new GameError('NOT_IN_GUILD');
  return g;
}

function parts(bossId: number): PartRow[] {
  return db
    .prepare('SELECT * FROM guild_boss_part WHERE boss_id = ? ORDER BY damage DESC')
    .all(bossId) as unknown as PartRow[];
}

/** 처치/기한 만료 시 참가자에게 보상을 지급하고 보스를 종료한다 (트랜잭션 안에서 호출) */
function finish(boss: BossRow, won: boolean, now: number): void {
  const tier = tierById(boss.tier);
  const ratio = won ? 1 : guildBossData.lostRewardRatio;
  const list = parts(boss.id).filter((p) => p.attacks > 0);
  list.forEach((p, rank) => {
    const ch = db.prepare('SELECT race FROM characters WHERE id = ?').get(p.character_id) as
      { race: string } | undefined;
    if (!ch) return;
    const res = db
      .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
      .get(p.character_id) as Record<string, number>;
    const cap = characterStorageCap(p.character_id, now);
    const paid: Record<string, number> = {};
    for (const [k, v] of Object.entries(scaleReward(tier.reward, ratio))) {
      const next = Math.max(res[k], Math.min(cap, res[k] + v)); // 상한 초과분은 버림
      paid[k] = Math.floor(next - res[k]);
      db.prepare(`UPDATE resources SET ${k} = ? WHERE character_id = ?`).run(next, p.character_id);
    }
    const speedupMin = Math.floor(tier.speedupMin * ratio);
    if (speedupMin > 0) addSpeedup(p.character_id, speedupMin * 60);
    // 처치 시 피해 1위(들)에게 장비 (보관함이 가득 차면 생략)
    const equipment: GrantedItem[] = [];
    if (won && rank === 0 && !inventoryFull(p.character_id))
      for (let i = 0; i < tier.topEquipment; i++) {
        const it = grantRandomEquipment(p.character_id, ch.race);
        if (it) equipment.push(it);
      }
    db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
      p.character_id,
      'guildBossDone',
      JSON.stringify({
        won,
        tier: tier.id,
        damage: p.damage,
        rank: rank + 1,
        reward: paid,
        speedupMin,
        equipment,
      }),
      now,
    );
  });
  if (won)
    db.prepare('UPDATE guilds SET exp = exp + ? WHERE id = ?').run(tier.guildExp, boss.guild_id);
  db.prepare('UPDATE guild_boss SET status = ?, finished_at = ?, hp = ? WHERE id = ?').run(
    won ? 'won' : 'lost',
    now,
    won ? 0 : boss.hp,
    boss.id,
  );
}

function activeBoss(guildId: number, now: number): BossRow | undefined {
  const boss = db
    .prepare("SELECT * FROM guild_boss WHERE guild_id = ? AND status = 'active'")
    .get(guildId) as unknown as BossRow | undefined;
  if (boss && boss.ends_at <= now) {
    transaction(() => finish(boss, false, now));
    return undefined;
  }
  return boss;
}

function lastFinished(guildId: number): BossRow | undefined {
  return db
    .prepare(
      "SELECT * FROM guild_boss WHERE guild_id = ? AND status != 'active' ORDER BY id DESC LIMIT 1",
    )
    .get(guildId) as unknown as BossRow | undefined;
}

export function bossState(characterId: number) {
  settle(characterId);
  const now = Date.now();
  const g = myGuild(characterId);
  const level = guildLevel(g.exp);
  const boss = activeBoss(g.id, now);
  const last = lastFinished(g.id);
  const cooldownUntil = last?.finished_at
    ? last.finished_at + guildBossData.summonCooldownHours * 3_600_000
    : 0;
  const tier = tierFor(level);
  const list = boss ? parts(boss.id) : [];
  const mine = list.find((p) => p.character_id === characterId);
  const today = dayKey();
  const names = new Map(
    (
      db
        .prepare(
          `SELECT c.id AS id, u.nickname AS owner FROM guild_boss_part p
           JOIN characters c ON c.id = p.character_id JOIN users u ON u.id = c.user_id WHERE p.boss_id = ?`,
        )
        .all(boss?.id ?? -1) as unknown as { id: number; owner: string }[]
    ).map((r) => [r.id, r.owner]),
  );
  return {
    serverNow: now,
    isLeader: g.leader_id === characterId,
    ticketsPerDay: guildBossData.ticketsPerDay,
    lossRatio: guildBossData.lossRatio,
    summonTier: tier.id,
    summonCooldownUntil: cooldownUntil,
    canSummon: g.leader_id === characterId && !boss && now >= cooldownUntil,
    active: boss
      ? {
          tier: boss.tier,
          hp: boss.hp,
          hpMax: boss.hp_max,
          endsAt: boss.ends_at,
          ticketsLeft: ticketsLeft(mine && mine.day === today ? mine.day_attacks : 0),
          myDamage: mine?.damage ?? 0,
          ranking: list.slice(0, 10).map((p) => ({
            owner: names.get(p.character_id) ?? '?',
            damage: p.damage,
            attacks: p.attacks,
            isMe: p.character_id === characterId,
          })),
        }
      : null,
    last: last
      ? {
          tier: last.tier,
          won: last.status === 'won',
          finishedAt: last.finished_at,
          hpMax: last.hp_max,
        }
      : null,
  };
}

export function summonBoss(characterId: number): void {
  settle(characterId);
  const now = Date.now();
  const g = myGuild(characterId);
  if (g.leader_id !== characterId) throw new GameError('NOT_GUILD_LEADER', 403);
  if (activeBoss(g.id, now)) throw new GameError('BOSS_ALREADY_ACTIVE');
  const last = lastFinished(g.id);
  if (last?.finished_at && now < last.finished_at + guildBossData.summonCooldownHours * 3_600_000)
    throw new GameError('BOSS_COOLDOWN');
  const tier = tierFor(guildLevel(g.exp));
  const members = db
    .prepare('SELECT character_id FROM guild_members WHERE guild_id = ?')
    .all(g.id) as unknown as { character_id: number }[];
  const sum = members.reduce((s, m) => s + memberCP(m.character_id), 0);
  const hp = bossHp(sum, tier);
  db.prepare(
    'INSERT INTO guild_boss (guild_id, tier, hp_max, hp, started_at, ends_at) VALUES (?,?,?,?,?,?)',
  ).run(g.id, tier.id, hp, hp, now, now + guildBossData.durationHours * 3_600_000);
}

export function attackBoss(characterId: number, selection: Record<string, number>) {
  settle(characterId);
  const now = Date.now();
  const g = myGuild(characterId);
  const boss = activeBoss(g.id, now);
  if (!boss) throw new GameError('NO_ACTIVE_BOSS');
  const today = dayKey();
  const mine = db
    .prepare('SELECT * FROM guild_boss_part WHERE boss_id = ? AND character_id = ?')
    .get(boss.id, characterId) as unknown as PartRow | undefined;
  const usedToday = mine && mine.day === today ? mine.day_attacks : 0;
  if (ticketsLeft(usedToday) < 1) throw new GameError('BOSS_NO_TICKET');

  const { armyA } = selectArmy(characterId, selection);
  const damage = rollDamage(armyCP(armyA));
  const losses = bossLosses(armyA);
  let killed = false;
  transaction(() => {
    applyLosses(characterId, losses);
    const hp = Math.max(0, boss.hp - damage);
    db.prepare('UPDATE guild_boss SET hp = ? WHERE id = ?').run(hp, boss.id);
    db.prepare(
      `INSERT INTO guild_boss_part (boss_id, character_id, damage, attacks, day, day_attacks)
       VALUES (?,?,?,1,?,1)
       ON CONFLICT(boss_id, character_id) DO UPDATE SET damage = damage + excluded.damage,
         attacks = attacks + 1,
         day_attacks = CASE WHEN day = excluded.day THEN day_attacks + 1 ELSE 1 END,
         day = excluded.day`,
    ).run(boss.id, characterId, damage, today);
    if (hp <= 0) {
      killed = true;
      finish({ ...boss, hp: 0 }, true, now);
    }
  });
  return {
    damage,
    lost: losses.reduce((s, l) => s + l.count, 0),
    killed,
    state: bossState(characterId),
  };
}
