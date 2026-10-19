const TOKEN_KEY = 'dot.token';
const LOGIN_ID_KEY = 'dot.loginId';
const NICK_KEY = 'dot.nickname';

export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface ServerInfo {
  id: number;
  name: string;
  status: 'smooth' | 'normal' | 'busy';
  hasCharacter: boolean;
  myRace: string | null;
  myTerritoryName: string | null;
  myLevel: number | null;
}
export interface RaceData {
  id: string;
  enabled: boolean;
  theme: string[];
  mods: {
    combatPower: number;
    resourceGain: number;
    trainSpeed: number;
    costRate: number;
    equipGrade: string;
    classPower: Record<string, number>;
  };
  startUnit: string;
}
export interface UnitData {
  id: string;
  race: string;
  tier: number;
  class: string;
  requiredTerritoryLevel: number;
  baseStats: { hp: number; attack: number; defense: number; speed: number };
  cost: Record<string, number>;
  trainTimeSec: number;
  sprite: string;
}
export interface BuildingData {
  id: string;
  category: string;
  unlockLevel: number;
  buildable: boolean;
  maxCount: number;
  cost: Record<string, number>;
  buildTimeSec: number;
  maxLevel?: number;
  speedBonus?: { kind: 'train' | 'craft'; perLevel: number };
  color: string;
  production?: { resource: string; perHour: number };
  popBonus?: number;
  storageBonus?: number;
}
export interface CharacterState {
  id: number;
  serverId: number;
  race: string;
  territoryName: string;
  territoryLevel: number;
  resources: Record<string, number>;
  buildings: {
    id: number;
    type: string;
    level: number;
    finishAt: number | null;
    upgradeTo: number | null;
    upgradeFinishAt: number | null;
  }[];
  units: { unitId: string; count: number }[];
  totalTroops: number;
  totalCP: number;
  serverNow: number;
  trainBonus: number;
  craftBonus: number;
  protectedUntil: number;
  /** 보유 가속(초) */
  speedupSec: number;
  pvpCooldownUntil: number;
  equipBonusPct: number;
  unitCP: Record<string, number>;
  trainSlots: number;
  trainQueue: { id: number; unitId: string; amount: number; finishAt: number }[];
  queuedTroops: number;
  levelUp: { to: number; finishAt: number } | null;
  maxTroops: number;
  storageCap: number;
  buildSlots: number;
  constructing: number;
  awayTroops: number;
  idleTroops: number;
  logs: { key: string; params: Record<string, string | number>; at: number }[];
}
export interface TerritoryLevelData {
  level: number;
  maxTroops: number;
  unlockTier: number;
  cost?: Record<string, number>;
  timeSec?: number;
}
export interface StageInfo {
  id: string;
  requiredLevel: number;
  locked: boolean;
  army: { unitId: string; count: number; cp: number }[];
  enemyCP: number;
  reward: Record<string, number>;
  firstClearSpeedupMin: number;
  cleared: boolean;
  rewardLeft: number;
}
export interface BattleOutcome {
  winner: 'A' | 'B' | 'draw';
  aCP: number;
  bCP: number;
  aLosses: { unitId: string; count: number }[];
  bLosses: { unitId: string; count: number }[];
  armyA: { unitId: string; count: number }[];
  armyB: { unitId: string; count: number }[];
  rewards: Record<string, number>;
  /** 첫 클리어로 받은 가속(분) */
  speedupMin?: number;
  rewardCapped?: boolean;
  stageId: string;
  targetName?: string;
  seed: number;
}
export interface EquipItem {
  id: number;
  type: string;
  grade: string;
  power: number;
  equipped: boolean;
}
export interface EquipmentState {
  serverNow: number;
  hasSmithy: boolean;
  craftSlots: number;
  maxInventory: number;
  multiplier: number;
  items: EquipItem[];
  queue: { id: number; type: string; finishAt: number }[];
}
export interface EquipmentData {
  types: { id: string; cost: Record<string, number>; craftTimeSec: number }[];
  grades: { id: string; weight: number; power: number; color: string }[];
}
export interface PvpTarget {
  id: number;
  territoryName: string;
  owner: string;
  race: string;
  level: number;
  cp: number;
}
export interface PvpTargets {
  serverNow: number;
  myCP: number;
  cooldownUntil: number;
  protectedUntil: number;
  rangeMin: number;
  rangeMax: number;
  targets: PvpTarget[];
}
export interface QuestView {
  id: string;
  count: number;
  progress: number;
  claimed: boolean;
  reward: Record<string, number>;
}
export interface QuestsState {
  serverNow: number;
  resetAt: number;
  tutorial: QuestView[];
  daily: QuestView[];
  dailyBonus: { complete: boolean; claimed: boolean; reward: Record<string, number> };
  attendance: {
    streak: number;
    claimedToday: boolean;
    canClaim: boolean;
    nextDay: number;
    rewards: { day: number; reward: Record<string, number> }[];
  };
}
export interface GrantSummary {
  resources: Record<string, number>;
  equipment: { type: string; grade: string; power: number } | null;
  speedupMin?: number;
  day?: number;
}
export interface OfflineReport {
  awaySec: number;
  resourceDelta: Record<string, number>;
  events: { key: string; params: Record<string, unknown>; at: number }[];
}
export interface DungeonState {
  serverNow: number;
  resetAt: number;
  minLevel: number;
  locked: boolean;
  bestFloor: number;
  maxFloors: number;
  baseCP: number;
  cpGrowth: number;
  entriesLeft: number;
  maxEntries: number;
  preview: {
    floor: number;
    enemyCP: number;
    enemyUnitId: string;
    reward: Record<string, number>;
  }[];
  milestones: { speedupEvery: number; speedupMinPerStep: number; equipmentEvery: number };
}
export interface DungeonRun {
  floors: {
    floor: number;
    enemyCP: number;
    myCP: number;
    winner: 'A' | 'B' | 'draw';
    lost: number;
  }[];
  cleared: number;
  reason: 'stop' | 'defeat' | 'max';
  newBest: boolean;
  bestFloor: number;
  resources: Record<string, number>;
  speedupMin: number;
  equipment: { type: string; grade: string; power: number }[];
  equipmentSkipped: boolean;
  survivors: { unitId: string; count: number }[];
  state: DungeonState;
}
export interface GuildMember {
  characterId: number;
  owner: string;
  territoryName: string;
  level: number;
  contribution: number;
  isLeader: boolean;
}
export interface GuildState {
  serverNow: number;
  minLevel: number;
  locked: boolean;
  createCost: Record<string, number>;
  nameLength: { min: number; max: number };
  noticeMaxLength: number;
  donate: { limit: number; used: number; values: Record<string, number>; expPerValue: number };
  guild: {
    id: number;
    name: string;
    level: number;
    maxLevel: number;
    exp: number;
    nextExp: number | null;
    notice: string;
    memberCount: number;
    maxMembers: number;
    isLeader: boolean;
    buff: { production: number; combat: number };
    members: GuildMember[];
  } | null;
}
export interface GuildListItem {
  id: number;
  name: string;
  level: number;
  leader: string;
  members: number;
  maxMembers: number;
}
export interface GuildBossState {
  serverNow: number;
  isLeader: boolean;
  ticketsPerDay: number;
  lossRatio: number;
  summonTier: string;
  summonCooldownUntil: number;
  canSummon: boolean;
  active: {
    tier: string;
    hp: number;
    hpMax: number;
    endsAt: number;
    ticketsLeft: number;
    myDamage: number;
    ranking: { owner: string; damage: number; attacks: number; isMe: boolean }[];
  } | null;
  last: { tier: string; won: boolean; finishedAt: number | null; hpMax: number } | null;
}
export interface MarketState {
  serverNow: number;
  hasMarket: boolean;
  level: number;
  fee: number;
  dailyLimit: number;
  usedToday: number;
  values: Record<string, number>;
}
export interface TechView {
  id: string;
  effect: string;
  perLevel: number;
  level: number;
  maxLevel: number;
  unlockLevel: number;
  locked: boolean;
  next: { cost: Record<string, number>; timeSec: number } | null;
}
export interface ResearchState {
  serverNow: number;
  hasLab: boolean;
  job: { techId: string; toLevel: number; finishAt: number } | null;
  techs: TechView[];
}
export interface RankRow {
  rank: number;
  id: number;
  name: string;
  owner: string;
  race: string;
  level: number;
  cp: number;
  isMe: boolean;
}
export interface RankingState {
  type: 'cp' | 'level';
  total: number;
  top: RankRow[];
  me: RankRow | null;
}
export interface ExploreNode {
  id: number;
  resource: string;
  x: number;
  y: number;
  remaining: number;
}
export interface Expedition {
  id: number;
  resource: string;
  x: number;
  y: number;
  troops: number;
  yield: number;
  startAt: number;
  finishAt: number;
}
export interface ExploreState {
  serverNow: number;
  tileSec: number;
  carryPerUnit: number;
  carryBonus: number;
  slots: number;
  idleTroops: number;
  nodes: ExploreNode[];
  expeditions: Expedition[];
}

export const session = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  get nickname(): string | null {
    return localStorage.getItem(NICK_KEY);
  },
  get loginId(): string | null {
    return localStorage.getItem(LOGIN_ID_KEY);
  },
  set(token: string, nickname: string, loginId?: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NICK_KEY, nickname);
    if (loginId) localStorage.setItem(LOGIN_ID_KEY, loginId);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NICK_KEY);
  },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError('NETWORK');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) session.clear();
    throw new ApiError((body as { error?: string }).error ?? 'UNKNOWN');
  }
  return body as T;
}

export const api = {
  register: (loginId: string, password: string, nickname: string) =>
    request<{ token: string; nickname: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ loginId, password, nickname }),
    }),
  login: (loginId: string, password: string) =>
    request<{ token: string; nickname: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ loginId, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),
  servers: () => request<ServerInfo[]>('/api/servers'),
  createCharacter: (serverId: number, race: string, territoryName: string) =>
    request<CharacterState>(`/api/servers/${serverId}/character`, {
      method: 'POST',
      body: JSON.stringify({ race, territoryName }),
    }),
  me: (serverId: number, touch = false) =>
    request<CharacterState>(`/api/character/me?server=${serverId}${touch ? '&touch=1' : ''}`),
  races: () => request<{ races: RaceData[] }>('/api/data/races'),
  units: () => request<{ units: UnitData[] }>('/api/data/units'),
  buildings: () =>
    request<{
      categories: string[];
      upgrade: { costGrowth: number; timeGrowth: number };
      spriteTiers: number[];
      buildings: BuildingData[];
    }>('/api/data/buildings'),
  levels: () => request<{ levels: TerritoryLevelData[] }>('/api/data/territory_levels'),
  train: (server: number, unitId: string, amount: number) =>
    request<CharacterState>('/api/units/train', {
      method: 'POST',
      body: JSON.stringify({ server, unitId, amount }),
    }),
  stages: (server: number) => request<StageInfo[]>(`/api/battle/stages?server=${server}`),
  battleStart: (server: number, stageId: string, units: Record<string, number>) =>
    request<BattleOutcome>('/api/battle/start', {
      method: 'POST',
      body: JSON.stringify({ server, stageId, units }),
    }),
  equipmentData: () => request<EquipmentData>('/api/data/equipment'),
  equipment: (server: number) => request<EquipmentState>(`/api/equipment?server=${server}`),
  craft: (server: number, type: string) =>
    request<EquipmentState>('/api/smithy/craft', {
      method: 'POST',
      body: JSON.stringify({ server, type }),
    }),
  equip: (server: number, itemId: number) =>
    request<EquipmentState>('/api/equipment/equip', {
      method: 'POST',
      body: JSON.stringify({ server, itemId }),
    }),
  unequip: (server: number, itemId: number) =>
    request<EquipmentState>('/api/equipment/unequip', {
      method: 'POST',
      body: JSON.stringify({ server, itemId }),
    }),
  salvage: (server: number, itemId: number) =>
    request<EquipmentState>('/api/equipment/salvage', {
      method: 'POST',
      body: JSON.stringify({ server, itemId }),
    }),
  pvpTargets: (server: number) => request<PvpTargets>(`/api/pvp/targets?server=${server}`),
  pvpAttack: (server: number, targetId: number, units: Record<string, number>) =>
    request<BattleOutcome>('/api/pvp/attack', {
      method: 'POST',
      body: JSON.stringify({ server, targetId, units }),
    }),
  enterSession: (server: number) =>
    request<{ report: OfflineReport | null }>('/api/session/enter', {
      method: 'POST',
      body: JSON.stringify({ server }),
    }),
  quests: (server: number) => request<QuestsState>(`/api/quests?server=${server}`),
  claimQuest: (server: number, questId: string) =>
    request<{ summary: GrantSummary; quests: QuestsState }>('/api/quests/claim', {
      method: 'POST',
      body: JSON.stringify({ server, questId }),
    }),
  claimAttendance: (server: number) =>
    request<{ summary: GrantSummary; quests: QuestsState }>('/api/attendance/claim', {
      method: 'POST',
      body: JSON.stringify({ server }),
    }),
  dungeon: (server: number) => request<DungeonState>(`/api/dungeon?server=${server}`),
  dungeonRun: (server: number, units: Record<string, number>, stopAt: number) =>
    request<DungeonRun>('/api/dungeon/run', {
      method: 'POST',
      body: JSON.stringify({ server, units, stopAt }),
    }),
  guild: (server: number) => request<GuildState>(`/api/guild?server=${server}`),
  guildBoss: (server: number) => request<GuildBossState>(`/api/guild/boss?server=${server}`),
  guildBossSummon: (server: number) =>
    request<GuildBossState>('/api/guild/boss/summon', {
      method: 'POST',
      body: JSON.stringify({ server }),
    }),
  guildBossAttack: (server: number, units: Record<string, number>) =>
    request<{ damage: number; lost: number; killed: boolean; state: GuildBossState }>(
      '/api/guild/boss/attack',
      { method: 'POST', body: JSON.stringify({ server, units }) },
    ),
  guildList: (server: number) => request<GuildListItem[]>(`/api/guild/list?server=${server}`),
  guildCreate: (server: number, name: string) =>
    request<GuildState>('/api/guild/create', {
      method: 'POST',
      body: JSON.stringify({ server, name }),
    }),
  guildJoin: (server: number, guildId: number) =>
    request<GuildState>('/api/guild/join', {
      method: 'POST',
      body: JSON.stringify({ server, guildId }),
    }),
  guildLeave: (server: number) =>
    request<GuildState>('/api/guild/leave', { method: 'POST', body: JSON.stringify({ server }) }),
  guildDisband: (server: number) =>
    request<GuildState>('/api/guild/disband', { method: 'POST', body: JSON.stringify({ server }) }),
  guildKick: (server: number, targetId: number) =>
    request<GuildState>('/api/guild/kick', {
      method: 'POST',
      body: JSON.stringify({ server, targetId }),
    }),
  guildTransfer: (server: number, targetId: number) =>
    request<GuildState>('/api/guild/transfer', {
      method: 'POST',
      body: JSON.stringify({ server, targetId }),
    }),
  guildNotice: (server: number, notice: string) =>
    request<GuildState>('/api/guild/notice', {
      method: 'POST',
      body: JSON.stringify({ server, notice }),
    }),
  guildDonate: (server: number, resource: string, amount: number) =>
    request<{ result: { exp: number }; guild: GuildState }>('/api/guild/donate', {
      method: 'POST',
      body: JSON.stringify({ server, resource, amount }),
    }),
  market: (server: number) => request<MarketState>(`/api/market?server=${server}`),
  exchange: (server: number, from: string, to: string, amount: number) =>
    request<{ result: { spent: number; got: number; lostToCap: number }; market: MarketState }>(
      '/api/market/exchange',
      { method: 'POST', body: JSON.stringify({ server, from, to, amount }) },
    ),
  research: (server: number) => request<ResearchState>(`/api/research?server=${server}`),
  startResearch: (server: number, techId: string) =>
    request<ResearchState>('/api/research/start', {
      method: 'POST',
      body: JSON.stringify({ server, techId }),
    }),
  speedup: (
    server: number,
    target: 'levelup' | 'building' | 'research',
    seconds: number,
    buildingId?: number,
  ) =>
    request<{ used: number; remaining: number }>('/api/speedup', {
      method: 'POST',
      body: JSON.stringify({ server, target, seconds, buildingId }),
    }),
  ranking: (server: number, type: 'cp' | 'level') =>
    request<RankingState>(`/api/ranking?server=${server}&type=${type}`),
  levelUp: (server: number) =>
    request<CharacterState>('/api/territory/levelup', {
      method: 'POST',
      body: JSON.stringify({ server }),
    }),
  upgradeBuilding: (server: number, buildingId: number) =>
    request<CharacterState>('/api/building/upgrade', {
      method: 'POST',
      body: JSON.stringify({ server, buildingId }),
    }),
  build: (server: number, type: string) =>
    request<CharacterState>('/api/building/build', {
      method: 'POST',
      body: JSON.stringify({ server, type }),
    }),
  explore: (server: number) => request<ExploreState>(`/api/explore?server=${server}`),
  sendExpedition: (server: number, nodeId: number, troops: number) =>
    request<ExploreState>('/api/explore/send', {
      method: 'POST',
      body: JSON.stringify({ server, nodeId, troops }),
    }),
};

/** 에셋 매니페스트 기반 스프라이트 조회. 없으면 null -> 플레이스홀더 */
let manifest: Record<string, string> | null = null;
export async function loadManifest(): Promise<Record<string, string>> {
  if (manifest) return manifest;
  try {
    const res = await fetch('/manifest.json');
    manifest = ((await res.json()) as { sprites: Record<string, string> }).sprites;
  } catch {
    manifest = {};
  }
  return manifest;
}
