import { randomBytes } from 'node:crypto';
import { db, transaction } from '../db/db.js';
import { gameConfig, races, territoryLevels, units } from '../data.js';
import { armyPlan, cumulativeDaysTo, levelAtAge, npcSpeed, virtualAgeDays } from './npcRules.js';

/**
 * 혼자 하는 판의 가상 플레이어(NPC) 세계.
 * NPC 는 진짜 캐릭터 행(users.is_npc = 1)이라서 랭킹/결투/길드가 기존 코드 그대로 동작한다.
 * 시간이 지나면 NPC 의 영지 레벨·병력·자원이 자라고(syncNpcs), 공격받아 줄어든 병력은 다시 채워진다.
 * 온라인(서버) 판에서는 ensureNpcWorld 를 부르지 않으므로 아무 일도 일어나지 않는다.
 */

const DAY_MS = 86_400_000;
const SERVER_ID = 1;
const SYNC_EVERY_MS = 30_000;
const GUILD_EXP_PER_MEMBER_DAY = 90;

let enabled = false;
let lastSync = 0;
export const npcEnabled = (): boolean => enabled;

const OWNER = [
  '카이론',
  '리아나',
  '벨리온',
  '세라핀',
  '드레이크',
  '아델라',
  '로웬',
  '이솔데',
  '가르윈',
  '미라벨',
  '발더',
  '에스텔',
  '토린',
  '나이라',
  '오르윈',
  '실비아',
  '하겐',
  '프레이야',
  '브란',
  '엘리제',
  '라그나',
  '유니아',
  '카심',
  '테오',
  '로제',
  '아스터',
  '피오나',
  '그렌',
  '마리우스',
  '노라',
  '시구르드',
  '베아트리스',
  '울프릭',
  '카밀라',
  '자일스',
  '이렌',
  '오스카',
  '레이나',
  '다미안',
  '셀레네',
];
const TERRITORY = [
  '은빛성채',
  '붉은달 요새',
  '서리감시탑',
  '황금보리 마을',
  '검은숲 진지',
  '푸른샘 영지',
  '바람언덕 성',
  '철의 문',
  '새벽항구',
  '고요한 골짜기',
  '용의 둥지',
  '달빛 정원',
  '폭풍 절벽',
  '불꽃 대장촌',
  '안개늪 초소',
  '별빛 성채',
  '돌사자 요새',
  '갈대 호수성',
  '진홍 깃발 성',
  '옛 왕의 언덕',
  '북쪽 방벽',
  '여우굴 마을',
  '장미 가시성',
  '회색 첨탑',
];
const GUILD = [
  '붉은 늑대단',
  '푸른 서약',
  '강철 형제회',
  '새벽의 방패',
  '그림자 상단',
  '황혼 기사단',
];

const pick = <T>(list: T[], i: number): T => list[i % list.length];

function kvGet(key: string): string | null {
  const r = db.prepare('SELECT value FROM app_kv WHERE key = ?').get(key) as
    { value: string } | undefined;
  return r?.value ?? null;
}
function kvSet(key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

const enabledRaces = (): string[] => races.races.filter((r) => r.enabled).map((r) => r.id);

function uniqueNickname(base: string): string {
  let name = base;
  for (let n = 2; db.prepare('SELECT 1 FROM users WHERE nickname = ?').get(name); n++)
    name = `${base}${n}`;
  return name;
}

/** NPC 한 명을 만든다. ageDays 는 "이미 이만큼 자란" 가상 나이. */
export function spawnNpc(now: number, index: number, ageDays: number): number {
  const race = pick(enabledRaces(), index);
  const nick = uniqueNickname(pick(OWNER, index));
  const user = db
    .prepare('INSERT INTO users (nickname, token, is_npc, created_at) VALUES (?, ?, 1, ?)')
    .run(nick, `npc-${randomBytes(12).toString('hex')}`, now);
  // created_at 을 과거로 잡아 신규 보호 기간(결투 불가)을 이미 지난 상태로 만든다
  const born = now - 3 * DAY_MS;
  const suffix = index >= TERRITORY.length ? ` ${Math.floor(index / TERRITORY.length) + 1}` : '';
  const ch = db
    .prepare(
      'INSERT INTO characters (user_id, server_id, race, territory_name, territory_level, created_at) VALUES (?,?,?,?,?,?)',
    )
    .run(
      Number(user.lastInsertRowid),
      SERVER_ID,
      race,
      pick(TERRITORY, index + 3) + suffix,
      levelAtAge(ageDays),
      born,
    );
  const id = Number(ch.lastInsertRowid);
  db.prepare(
    'INSERT INTO resources (character_id, food, wood, stone, iron, gold, updated_at) VALUES (?,0,0,0,0,0,?)',
  ).run(id, now);
  kvSet(`npc_age_${id}`, String(ageDays));
  kvSet(`npc_t0_${id}`, String(now));
  return id;
}

interface NpcChar {
  id: number;
  race: string;
  level: number;
}
const npcChars = (): NpcChar[] =>
  db
    .prepare(
      'SELECT c.id, c.race, c.territory_level AS level FROM characters c JOIN users u ON u.id = c.user_id WHERE u.is_npc = 1',
    )
    .all() as unknown as NpcChar[];

function npcAge(id: number, now: number): number {
  const base = Number(kvGet(`npc_age_${id}`) ?? 0);
  const t0 = Number(kvGet(`npc_t0_${id}`) ?? now);
  return virtualAgeDays(t0, now, npcSpeed(id), base);
}

/** NPC 의 레벨/병력/자원을 지금 시각에 맞춘다 (공격받아 줄어든 병력과 약탈당한 자원도 채운다) */
export function syncNpcs(now: number, force = false): void {
  if (!enabled || (!force && now - lastSync < SYNC_EVERY_MS)) return;
  lastSync = now;
  transaction(() => {
    for (const n of npcChars()) {
      const level = levelAtAge(npcAge(n.id, now));
      if (level !== n.level)
        db.prepare('UPDATE characters SET territory_level = ? WHERE id = ?').run(level, n.id);
      // 병력: 레벨의 최대 병력의 65~99% (장비 효과를 흉내 내 15% 가산)
      const lv = territoryLevels.levels.find((l) => l.level === level)!;
      const fill = 0.65 + ((n.id * 31) % 35) / 100;
      const target = Math.round(lv.maxTroops * fill * 1.15);
      const have = (
        db
          .prepare('SELECT COALESCE(SUM(count),0) AS n FROM unit_stock WHERE character_id = ?')
          .get(n.id) as { n: number }
      ).n;
      if (level !== n.level || have < target * 0.85) {
        const pool = units.units
          .filter((u) => u.race === n.race && u.requiredTerritoryLevel <= level)
          .map((u) => ({ id: u.id, tier: u.tier }));
        db.prepare('DELETE FROM unit_stock WHERE character_id = ?').run(n.id);
        for (const p of armyPlan(pool, target))
          db.prepare('INSERT INTO unit_stock (character_id, unit_id, count) VALUES (?,?,?)').run(
            n.id,
            p.unitId,
            p.count,
          );
      }
      // 자원: 창고 상한의 25~65% 를 유지 (약탈당해도 다시 쌓인다)
      const cap = gameConfig.storage.base + (level - 1) * gameConfig.storage.perLevel;
      const goal = Math.round(cap * (0.25 + ((n.id * 17) % 40) / 100));
      const res = db
        .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
        .get(n.id) as Record<string, number>;
      for (const k of ['food', 'wood', 'stone', 'iron', 'gold'])
        if (res[k] < goal * 0.5)
          db.prepare(`UPDATE resources SET ${k} = ?, updated_at = ? WHERE character_id = ?`).run(
            goal,
            now,
            n.id,
          );
    }
    // NPC 길드 경험치: 길드원 수에 비례해 서서히 성장 (플레이어 기부는 따로 쌓인다)
    const guilds = db
      .prepare(
        `SELECT g.id, g.created_at AS createdAt, g.npc_portion AS portion,
                (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = g.id) AS members
         FROM guilds g JOIN characters lc ON lc.id = g.leader_id JOIN users u ON u.id = lc.user_id
         WHERE u.is_npc = 1`,
      )
      .all() as unknown as { id: number; createdAt: number; portion: number; members: number }[];
    for (const g of guilds) {
      const days = (now - g.createdAt) / DAY_MS;
      const formula = days * g.members * GUILD_EXP_PER_MEMBER_DAY;
      const delta = Math.floor(formula - (g.portion ?? 0));
      if (delta >= 1)
        db.prepare('UPDATE guilds SET exp = exp + ?, npc_portion = ? WHERE id = ?').run(
          delta,
          (g.portion ?? 0) + delta,
          g.id,
        );
    }
  });
}

/** 길드를 만들고 NPC 길드원을 채운다 */
function createNpcGuild(now: number, name: string, memberIds: number[], baseDays: number): void {
  const g = db
    .prepare(
      'INSERT INTO guilds (server_id, name, leader_id, created_at, notice) VALUES (?,?,?,?,?)',
    )
    .run(
      SERVER_ID,
      name,
      memberIds[0],
      now - baseDays * DAY_MS,
      '함께 성장할 길드원을 환영합니다!',
    );
  const gid = Number(g.lastInsertRowid);
  for (const id of memberIds)
    db.prepare('INSERT INTO guild_members (character_id, guild_id, joined_at) VALUES (?,?,?)').run(
      id,
      gid,
      now - baseDays * DAY_MS,
    );
}

function createWorld(now: number): void {
  transaction(() => {
    let index = 0;
    // 나이(일) 구성: 갓 시작한 영주부터 반 년 가까이 키운 영주까지
    const ages = [0.05, 0.3, 1.2, 2.5, 4, 6, 9, 13, 18, 25, 33, 42, 55, 70, 90, 120];
    for (let gi = 0; gi < 4; gi++) {
      const memberIds: number[] = [];
      for (let m = 0; m < 6; m++) {
        const age = ages[(gi * 4 + m * 3) % ages.length] * (0.8 + (m % 3) * 0.2);
        memberIds.push(spawnNpc(now, index++, age));
      }
      // 리더는 가장 높은 레벨
      memberIds.sort((a, b) => npcAge(b, now) - npcAge(a, now));
      createNpcGuild(now, GUILD[gi], memberIds, 6 + gi * 9);
    }
    for (let i = 0; i < 6; i++) spawnNpc(now, index++, ages[(i * 5 + 2) % ages.length] * 0.9);
  });
}

/** 혼자 하는 판 시작 시 호출: NPC 세계를 (없으면) 만들고 지금 시각에 맞춘다 */
export function ensureNpcWorld(now: number): void {
  enabled = true;
  const n = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_npc = 1').get() as { n: number })
    .n;
  if (n === 0) createWorld(now);
  syncNpcs(now, true);
}

/** 플레이어가 길드를 만들면 비슷한 레벨의 NPC 길드원을 데려온다 (혼자서도 길드 보스를 할 수 있도록) */
export function recruitNpcMembers(guildId: number, aroundLevel: number, count = 4): void {
  if (!enabled) return;
  const now = Date.now();
  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_npc = 1').get() as { n: number }
  ).n;
  transaction(() => {
    for (let i = 0; i < count; i++) {
      const lv = Math.max(1, Math.min(10, aroundLevel + (i % 3) - 1));
      const age = cumulativeDaysTo(lv) + 0.05 + i * 0.3;
      const id = spawnNpc(now, total + i, age);
      db.prepare(
        'INSERT INTO guild_members (character_id, guild_id, joined_at) VALUES (?,?,?)',
      ).run(id, guildId, now);
    }
  });
  syncNpcs(now, true);
}
