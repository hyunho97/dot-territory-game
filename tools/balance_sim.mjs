/**
 * 경제 밸런스 시뮬레이터 — data/*.json 을 읽어 "영지 레벨 N 도달까지 걸리는 시간"을 추정한다.
 *
 * 사용법: node tools/balance_sim.mjs [--race human] [--explore none|active] [--payback 10] [--check 30]
 *   --explore   active: 접속해서 탐험을 계속 보내는 플레이 / none: 방치(건물 생산만)
 *   --payback   생산 건물 건설/업그레이드 투자 회수 허용 시간(시간). 길수록 공격적으로 투자
 *   --check     플레이어가 접속해 행동하는 간격(분)
 *   --research  on|off  연구소(생산·보급 연구) 투자 반영 (기본 on)
 *   --quests    on|off  일일 퀘스트·출석 보상 수입 반영 (기본 on)
 *   --guild     on|off  영지 Lv.3 부터 길드에 가입해 매일 한도까지 기부하고 길드 생산 버프를 받음 (기본 on)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf-8'));
const buildingsData = load('buildings.json');
const levels = load('territory_levels.json').levels;
const cfg = load('game_config.json');
const expl = load('exploration.json');
const races = load('races.json').races;
const researchData = load('research.json').techs;
const questsData = load('quests.json');
const guildData = load('guild.json');
const marketValues = load('market.json').values;

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const raceId = arg('race', 'human');
const mode = arg('explore', 'active');
const PAYBACK_H = Number(arg('payback', 10));
const CHECK_MIN = Number(arg('check', 30));
const RESEARCH = arg('research', 'on') === 'on';
const QUESTS = arg('quests', 'on') === 'on';
const GUILD = arg('guild', 'on') === 'on';
const mods = races.find((r) => r.id === raceId).mods;
const RES = ['food', 'wood', 'stone', 'iron', 'gold'];
const defs = Object.fromEntries(buildingsData.buildings.map((b) => [b.id, b]));
const { costGrowth, timeGrowth } = buildingsData.upgrade;

const st = {
  t: 0, // 분
  level: 1,
  res: { ...cfg.start.resources },
  blds: [
    { type: 'town_hall', level: 1, busyUntil: 0 },
    { type: 'barracks', level: 1, busyUntil: 0 },
  ],
  levelUp: null, // {to, at}
  tech: { production: 0, logistics: 0 }, // 연구 레벨
  techJob: null, // {id, at}
  day: 0,
  guildExp: 0,
  guildDay: 0,
  donated: 0, // 누적 기부 가치
};
const guildLevel = () => guildData.levelExp.filter((need) => st.guildExp >= need).length;
const guildBuffProd = () => (GUILD && st.level >= guildData.minTerritoryLevel ? guildData.buffPerLevel.production * (guildLevel() - 1) : 0);
const guildReached = {};
const reached = { 1: 0 };

const buildSlots = () => cfg.buildSlots.base + Math.floor(st.level / cfg.buildSlots.levelsPerExtra);
const expSlots = () => expl.slots.base + Math.floor(st.level / expl.slots.levelsPerExtra);
const maxTroops = () => [...levels].filter((l) => l.level <= st.level).pop().maxTroops;
const cap = () =>
  cfg.storage.base +
  (st.level - 1) * cfg.storage.perLevel +
  st.blds
    .filter((b) => b.busyUntil <= st.t && defs[b.type].storageBonus)
    .reduce((s, b) => s + defs[b.type].storageBonus * b.level, 0);
const techBonus = (id) => (researchData.find((x) => x.id === id).perLevel) * st.tech[id];
const busyCount = () =>
  st.blds.filter((b) => b.busyUntil > st.t).length;
const canPay = (cost) => Object.entries(cost).every(([k, v]) => st.res[k] >= v);
const pay = (cost) => Object.entries(cost).forEach(([k, v]) => (st.res[k] -= v));
const scaled = (base, mult) =>
  Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.ceil(v * mult * mods.costRate)]));

function passiveIncomePerHour() {
  const inc = Object.fromEntries(RES.map((r) => [r, 0]));
  for (const b of st.blds) {
    const p = defs[b.type].production;
    if (p && b.busyUntil <= st.t) inc[p.resource] += p.perHour * b.level * mods.resourceGain * (1 + techBonus('production') + guildBuffProd());
  }
  return inc;
}

/** 접속 중 탐험을 계속 보내는 플레이의 평균 수입(시간당). 슬롯마다 (왕복시간 또는 접속 간격) 중 큰 쪽이 주기. */
function exploreIncomePerHour() {
  if (mode !== 'active') return Object.fromEntries(RES.map((r) => [r, 0]));
  const types = expl.nodeTypes.filter((n) => n.unlockLevel <= st.level);
  const totalW = types.reduce((s, n) => s + n.weight, 0);
  const troops = Math.max(5, Math.floor(maxTroops() * 0.6));
  const inc = Object.fromEntries(RES.map((r) => [r, 0]));
  for (const n of types) {
    const avgDist = (n.minDist + n.maxDist) / 2;
    const roundTripMin = (2 * Math.ceil(avgDist * expl.tileSec)) / 60;
    const cycleMin = Math.max(roundTripMin, CHECK_MIN);
    const nodeAmt = ((n.amount[0] + n.amount[1]) / 2) * (1 + (expl.amountPerLevel ?? 0) * (st.level - 1));
    const perTrip = Math.min(nodeAmt, troops * expl.carryPerUnit * mods.resourceGain * (1 + techBonus('logistics')));
    inc[n.resource] += ((n.weight / totalW) * expSlots() * perTrip * 60) / cycleMin;
  }
  return inc;
}

function step(dtMin) {
  const inc1 = passiveIncomePerHour();
  const inc2 = exploreIncomePerHour();
  const c = cap();
  for (const r of RES) {
    const add = ((inc1[r] + inc2[r]) * dtMin) / 60;
    if (st.res[r] < c) st.res[r] = Math.min(c, st.res[r] + add);
  }
  st.t += dtMin;
  if (st.techJob && st.techJob.at <= st.t) {
    st.tech[st.techJob.id]++;
    st.techJob = null;
  }
  // 길드: 영지 Lv.3 부터 매일 기부 한도까지 (식량/나무 위주, 자원의 30% 이내만) 기부
  if (GUILD && st.level >= guildData.minTerritoryLevel && Math.floor(st.t / 1440) > st.guildDay) {
    st.guildDay = Math.floor(st.t / 1440);
    let budget = guildData.dailyDonateValueLimit;
    for (const r of ['food', 'wood']) {
      const give = Math.min(budget / marketValues[r], st.res[r] * 0.3);
      st.res[r] -= give;
      budget -= give * marketValues[r];
      st.donated += give * marketValues[r];
      st.guildExp += Math.floor(give * marketValues[r] * guildData.expPerValue);
    }
    const lv = guildLevel();
    if (!guildReached[lv]) guildReached[lv] = st.t;
  }
  // 일일 퀘스트 + 출석(매일 1회, 접속 간격이 하루 이내인 플레이어 가정)
  if (QUESTS && Math.floor(st.t / 1440) > st.day) {
    st.day = Math.floor(st.t / 1440);
    const scale = 1 + questsData.rewardScalePerLevel * (st.level - 1);
    const rewards = [...questsData.daily.map((q) => q.reward), questsData.attendance[(st.day - 1) % 7].reward];
    const c = cap();
    for (const rw of rewards)
      for (const [k, v] of Object.entries(rw))
        if (RES.includes(k) && st.res[k] < c) st.res[k] = Math.min(c, st.res[k] + v * scale);
  }
  if (st.levelUp && st.levelUp.at <= st.t) {
    st.level = st.levelUp.to;
    st.blds.find((b) => b.type === 'town_hall').level = st.level;
    reached[st.level] = st.t;
    st.levelUp = null;
  }
  for (const b of st.blds) if (b.upgradeTo && b.busyUntil <= st.t) {
    b.level = b.upgradeTo;
    b.upgradeTo = 0;
  }
}

/** 투자 가치: 건물/업그레이드 비용(자원 합) 대비 시간당 생산 증가량 -> 회수 시간(시간) */
function paybackHours(cost, gainPerHour) {
  if (gainPerHour <= 0) return Infinity;
  return Object.values(cost).reduce((s, v) => s + v, 0) / gainPerHour;
}

function act() {
  // 1) 영지 레벨업
  const next = levels.find((l) => l.level === st.level + 1);
  if (!st.levelUp && next?.cost) {
    const cost = scaled(next.cost, 1);
    if (canPay(cost)) {
      pay(cost);
      st.levelUp = { to: next.level, at: st.t + next.timeSec / 60 };
    }
  }
  // 1.5) 연구소 건설 + 연구 (영지 Lv.5부터, 생산 → 보급 순으로 한 번에 하나)
  if (RESEARCH && st.level >= 5) {
    const labDef = defs.lab;
    if (!st.blds.some((b) => b.type === 'lab') && busyCount() < buildSlots()) {
      const cost = scaled(labDef.cost, 1);
      if (canPay(cost)) {
        pay(cost);
        st.blds.push({ type: 'lab', level: 1, busyUntil: st.t + labDef.buildTimeSec / 60 });
      }
    }
    const lab = st.blds.find((b) => b.type === 'lab');
    if (lab && lab.busyUntil <= st.t && !st.techJob) {
      for (const id of ['production', 'logistics']) {
        const tech = researchData.find((x) => x.id === id);
        const lv = st.tech[id];
        if (lv >= tech.maxLevel || st.level < tech.unlockLevel) continue;
        const cost = Object.fromEntries(Object.entries(tech.cost).map(([k, v]) => [k, Math.ceil(v * Math.pow(tech.costGrowth, lv))]));
        if (!canPay(cost)) continue;
        pay(cost);
        st.techJob = { id, at: st.t + (tech.timeSec * Math.pow(tech.timeGrowth, lv)) / 60 };
        break;
      }
    }
  }
  // 2) 생산 건물 건설/업그레이드 (회수 시간 기준, 가장 효율 좋은 것부터)
  let guard = 0;
  while (busyCount() < buildSlots() && guard++ < 10) {
    const options = [];
    for (const d of buildingsData.buildings) {
      if (!d.buildable || d.unlockLevel > st.level) continue;
      const owned = st.blds.filter((b) => b.type === d.id);
      if (owned.length < d.maxCount && d.production) {
        const cost = scaled(d.cost, 1);
        options.push({ kind: 'build', d, cost, pb: paybackHours(cost, d.production.perHour), sec: d.buildTimeSec });
      }
      for (const b of owned) {
        if (!d.maxLevel || b.busyUntil > st.t || b.level >= Math.min(d.maxLevel, st.level)) continue;
        const cost = scaled(d.cost, Math.pow(costGrowth, b.level));
        const gain = d.production ? d.production.perHour : 0;
        const sec = Math.ceil(d.buildTimeSec * Math.pow(timeGrowth, b.level));
        options.push({ kind: 'up', d, b, cost, pb: paybackHours(cost, gain), sec });
      }
    }
    // 창고: 가장 많이 찬 자원이 상한의 85% 이상이면 필요
    const full = RES.some((r) => st.res[r] >= cap() * 0.85);
    for (const d of buildingsData.buildings.filter((x) => x.id === 'warehouse')) {
      const owned = st.blds.filter((b) => b.type === d.id);
      if (!full) continue;
      if (owned.length < d.maxCount) {
        options.push({ kind: 'build', d, cost: scaled(d.cost, 1), pb: 0, sec: d.buildTimeSec });
      }
      for (const b of owned) {
        if (b.busyUntil > st.t || b.level >= Math.min(d.maxLevel, st.level)) continue;
        options.push({ kind: 'up', d, b, cost: scaled(d.cost, Math.pow(costGrowth, b.level)), pb: 0.5, sec: Math.ceil(d.buildTimeSec * Math.pow(timeGrowth, b.level)) });
      }
    }
    // 한 자원만 몰아 짓지 않도록, 이미 많이 생산 중인 자원일수록 회수 시간에 가중치를 둔다
    const inc = passiveIncomePerHour();
    const score = (o) => o.pb * (1 + (o.d.production ? inc[o.d.production.resource] : 0) / 100);
    options.sort((a, b) => score(a) - score(b));
    const pick = options.find((o) => o.pb <= PAYBACK_H && canPay(o.cost));
    if (!pick) break;
    pay(pick.cost);
    if (pick.kind === 'build') st.blds.push({ type: pick.d.id, level: 1, busyUntil: st.t + pick.sec / 60 });
    else {
      pick.b.upgradeTo = pick.b.level + 1;
      pick.b.busyUntil = st.t + pick.sec / 60;
    }
  }
}

const MAX_MIN = 60 * 24 * 800; // 최대 800일
let lastAct = 0;
while (st.level < levels.length && st.t < MAX_MIN) {
  step(1);
  if (st.t - lastAct >= CHECK_MIN || st.t < 120) {
    act();
    lastAct = st.t;
  }
}

const fmt = (min) => {
  const h = min / 60;
  return h < 1 ? `${Math.round(min)}분` : h < 48 ? `${h.toFixed(1)}시간` : `${(h / 24).toFixed(1)}일`;
};
// (아래 출력에 길드 요약 추가)
console.log(`종족=${raceId} 탐험=${mode} 투자회수=${PAYBACK_H}h 접속간격=${CHECK_MIN}분 연구=${RESEARCH ? 'on' : 'off'} 퀘스트=${QUESTS ? 'on' : 'off'} 길드=${GUILD ? 'on' : 'off'}`);
console.log('레벨 | 도달 시각(누적) | 직전 레벨 대비');
let prev = 0;
for (let l = 1; l <= levels.length; l++) {
  if (reached[l] === undefined) {
    console.log(`Lv.${String(l).padStart(2)} | 도달 못함 (${fmt(MAX_MIN)} 이내)`);
    break;
  }
  console.log(`Lv.${String(l).padStart(2)} | ${fmt(reached[l]).padStart(9)} | +${fmt(reached[l] - prev)}`);
  prev = reached[l];
}
const inc = passiveIncomePerHour();
console.log('최종 방치 수입/시간:', Object.fromEntries(RES.map((r) => [r, Math.round(inc[r])])));

if (GUILD) {
  console.log(
    `길드: 최종 Lv.${guildLevel()} (경험치 ${Math.round(st.guildExp)}), 누적 기부 가치 ${Math.round(st.donated)}, 도달 시점:`,
    Object.entries(guildReached)
      .map(([lv, m]) => `Lv.${lv}=${fmt(m)}`)
      .join(' '),
  );
}
