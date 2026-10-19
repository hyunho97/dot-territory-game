/**
 * 던전 밸런스 시뮬레이터 — 실제 전투 엔진(resolveBattle)과 data/*.json 을 그대로 사용한다.
 *
 * 사용법: node --import tsx tools/dungeon_sim.ts [--race human] [--runs 300] [--mult 1.15]
 *   --mult  전투력 배수 가정 (장비 + 연구 + 길드 버프. 기본 1.15)
 * 영지 레벨별로 "최대 병력 + 그 레벨에서 쓸 수 있는 상위 유닛" 군대를 만들고, 목표 층(stopAt)별로
 * 평균 클리어 층 / 전멸 확률 / 자원 보상 가치 / 병력 손실 가치 / 순이익을 낸다.
 * 가치 환산은 data/market.json 의 자원 가치를 쓴다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { armyCP, createRng, resolveBattle } from '../server/src/services/battle.js';
import type { Army } from '../server/src/services/battle.js';
import { floorEnemyCP, floorEnemyUnitId, floorReward } from '../server/src/services/dungeonRules.js';
import { battleConfig, dungeonData, marketData, races, units } from '../server/src/data.js';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const raceId = arg('race', 'human');
const RUNS = Number(arg('runs', '300'));
const MULT = Number(arg('mult', '1.15'));

const levels = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../data/territory_levels.json', import.meta.url)), 'utf-8'),
  ) as { levels: { level: number; maxTroops: number }[] }
).levels;
const race = races.races.find((r) => r.id === raceId)!;
const value = (res: Record<string, number>): number =>
  Object.entries(res).reduce((s, [k, v]) => s + v * (marketData.values as Record<string, number>)[k], 0);
const unitCP = (u: (typeof units.units)[number], race?: string, mult = 1): number => {
  const mods = races.races.find((r) => r.id === race)?.mods;
  const base = u.baseStats.attack + u.baseStats.defense + u.baseStats.hp / 10;
  return base * (mods?.combatPower ?? 1) * (mods?.classPower[u.class] ?? 1) * mult;
};

/** 영지 레벨에서 쓸 수 있는 유닛 중 상위 2개 티어로 최대 병력을 채운다 (60% / 40%) */
function buildArmy(level: number): { army: Army; cost: Record<string, Record<string, number>> } {
  const pool = units.units.filter((u) => u.race === raceId && u.requiredTerritoryLevel <= level);
  const tiers = [...new Set(pool.map((u) => u.tier))].sort((a, b) => b - a);
  const top = pool.filter((u) => u.tier === tiers[0]);
  const next = pool.filter((u) => u.tier === (tiers[1] ?? tiers[0]));
  const troops = levels.find((l) => l.level === level)!.maxTroops;
  const army: Army = [];
  const cost: Record<string, Record<string, number>> = {};
  const add = (list: typeof pool, n: number) => {
    const per = Math.max(1, Math.floor(n / list.length));
    for (const u of list) {
      army.push({ unitId: u.id, cp: unitCP(u, raceId, MULT), count: per });
      cost[u.id] = u.cost;
    }
  };
  add(top, Math.round(troops * 0.6));
  if (next !== top) add(next, Math.round(troops * 0.4));
  return { army, cost };
}

function simulate(level: number, stopAt: number, seed0: number) {
  const { army: base, cost } = buildArmy(level);
  let cleared = 0;
  let rewardValue = 0;
  let lossValue = 0;
  let wiped = 0;
  for (let run = 0; run < RUNS; run++) {
    const army: Army = base.map((u) => ({ ...u }));
    const rng = createRng(seed0 + run);
    let reached = 0;
    for (let floor = 1; floor <= stopAt; floor++) {
      const def = units.units.find((u) => u.id === floorEnemyUnitId(floor))!;
      const per = unitCP(def);
      const enemy: Army = [
        { unitId: def.id, cp: per, count: Math.max(1, Math.round(floorEnemyCP(floor) / per)) },
      ];
      const r = resolveBattle(army, enemy, battleConfig, Math.floor(rng() * 0xffffffff));
      for (const l of r.aLosses) {
        const u = army.find((x) => x.unitId === l.unitId)!;
        u.count -= l.count;
        lossValue += value(cost[l.unitId]) * l.count;
      }
      if (r.winner !== 'A') {
        wiped++;
        break;
      }
      reached = floor;
      rewardValue += value(floorReward(floor, level));
      if (armyCP(army) <= 0) break;
    }
    cleared += reached;
  }
  return {
    cleared: cleared / RUNS,
    wipeRate: wiped / RUNS,
    reward: rewardValue / RUNS,
    loss: lossValue / RUNS,
  };
}

/** 방치 수입(가치/일) 대략치: 생산 건물을 종류당 2채, 건물 레벨 = 영지 레벨로 가정 */
function idleIncomePerDay(level: number): number {
  const b = JSON.parse(
    readFileSync(fileURLToPath(new URL('../data/buildings.json', import.meta.url)), 'utf-8'),
  ) as { buildings: { production?: { resource: string; perHour: number }; unlockLevel: number; maxCount: number }[] };
  let perHour = 0;
  for (const d of b.buildings)
    if (d.production && d.unlockLevel <= level)
      perHour +=
        d.production.perHour * level * Math.min(2, d.maxCount) *
        (marketData.values as Record<string, number>)[d.production.resource];
  return perHour * 24 * race.mods.resourceGain;
}

console.log(`종족=${raceId} 반복=${RUNS} 전투력배수=${MULT} 일일입장=${dungeonData.dailyEntries}`);
for (const level of [3, 5, 7, 10]) {
  const { army } = buildArmy(level);
  const cp = Math.round(armyCP(army));
  const idle = Math.round(idleIncomePerDay(level));
  console.log(`\n── 영지 Lv.${level} · 군대 전투력 ${cp} · 방치 수입 ≈ ${idle}/일(가치) ──`);
  console.log('목표층 | 평균클리어 | 전멸률 | 보상가치 | 손실가치 | 순이익/회 | 하루(3회)/방치수입');
  let best = { stop: 0, net: -Infinity };
  for (const stop of [3, 5, 8, 10, 15, 20, 25, 30, 40, 50]) {
    const r = simulate(level, stop, 1000 + stop);
    const net = r.reward - r.loss;
    if (net > best.net) best = { stop, net };
    console.log(
      `${String(stop).padStart(5)} | ${r.cleared.toFixed(1).padStart(9)} | ${(r.wipeRate * 100).toFixed(0).padStart(5)}% | ${String(Math.round(r.reward)).padStart(8)} | ${String(Math.round(r.loss)).padStart(8)} | ${String(Math.round(net)).padStart(9)} | ${((net * dungeonData.dailyEntries) / idle * 100).toFixed(0).padStart(6)}%`,
    );
  }
  console.log(`최적 목표층 ≈ ${best.stop} (순이익/회 ${Math.round(best.net)})`);
}
