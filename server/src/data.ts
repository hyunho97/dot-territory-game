import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8')) as T;
}

export interface RaceMods {
  combatPower: number;
  resourceGain: number;
  trainSpeed: number;
  costRate: number;
  equipGrade: string;
  classPower: Record<string, number>;
}
export interface RaceData {
  id: string;
  enabled: boolean;
  theme: string[];
  mods: RaceMods;
  startUnit: string;
}
export interface UnitData {
  id: string;
  race: string;
  tier: number;
  class: string;
  requiredTerritoryLevel: number;
  baseStats: Record<string, number>;
  cost: Record<string, number>;
  trainTimeSec: number;
  sprite: string;
}
export interface BuildingDef {
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
export interface NodeType {
  resource: string;
  unlockLevel: number;
  minDist: number;
  maxDist: number;
  amount: [number, number];
  weight: number;
}
export interface ExplorationData {
  tileSec: number;
  /** 보낸 병력의 전투력 1당 채집량 */
  carryPerCP: number;
  /** 자원 종류마다 가까운/중간/먼 곳에 이만큼씩 나온다 */
  perResource: number;
  /** 이 분마다 탐사 지점이 새로 나온다 */
  respawnMin: number;
  /** 거리 구간(가까움/중간/멈)별 자원량 배수 */
  bandAmountMult: number[];
  amountPerLevel?: number;
  eventChance: number;
  events: {
    id: string;
    weight: number;
    yieldMult?: number;
    goldBase?: number;
    goldPerLevel?: number;
    lossRatio?: [number, number];
    speedupMin?: [number, number];
  }[];
  slots: { base: number; levelsPerExtra: number };
  nodeTypes: NodeType[];
}

export const serversData = load<{
  congestion: { normalMax: number; busyMax: number };
  servers: { id: number; name: string }[];
}>('servers.json');
export const gameConfig = load<{
  nickname: { min: number; max: number };
  territoryName: { min: number; max: number };
  start: {
    territoryLevel: number;
    resources: Record<string, number>;
    buildings: { type: string; level: number; x: number; y: number }[];
    tier1UnitCount: number;
  };
  sessionDays: number;
  offlineMaxHours: number;
  storage: { base: number; perLevel: number };
  trainSlots: { base: number; levelsPerExtra: number };
  maxTrainAmount: number;
  offlineReportMinSec: number;
  buildSlots: { base: number; levelsPerExtra: number };
}>('game_config.json');
export const races = load<{ races: RaceData[] }>('races.json');
export const units = load<{ units: UnitData[] }>('units.json');
export const buildings = load<{
  categories: string[];
  upgrade: { costGrowth: number; timeGrowth: number };
  footprint: Record<string, number[]> & { default: number[] };
  spriteTiers: number[];
  buildings: BuildingDef[];
}>('buildings.json');
export const territoryLevels = load<{
  levels: {
    level: number;
    landRadius?: number;
    maxTroops: number;
    unlockTier: number;
    cost?: Record<string, number>;
    timeSec?: number;
  }[];
}>('territory_levels.json');
export const battleConfig = load<{
  winnerLossRatio: number;
  loserLossRatio: number;
  drawLossRatio: number;
  /** 이긴 쪽 전투력이 상대의 이 배수 이상이면 이긴 쪽은 손실이 없다 (없으면 적용 안 함) */
  noLossRatio?: number;
}>('battle_config.json');
export const pve = load<{
  /** 스테이지별 하루 보상 지급 승리 횟수 상한 (초과 승리는 보상 없음) */
  dailyRewardWins: number;
  stages: {
    id: string;
    requiredLevel: number;
    army: { unitId: string; count: number }[];
    cpMultiplier?: number;
    reward: Record<string, number>;
    /** 첫 클리어 시 1회 지급하는 가속(분) */
    firstClearSpeedupMin?: number;
  }[];
}>('pve.json');
export const equipmentData = load<{
  grades: {
    id: string;
    weight: number;
    power: number;
    salvage: Record<string, number>;
    color: string;
  }[];
  highGradeFrom: string;
  raceGradeMult: Record<string, number>;
  raceQualityMult: Record<string, number>;
  powerRoll: [number, number];
  types: { id: string; cost: Record<string, number>; craftTimeSec: number }[];
  craftSlots: { base: number; levelsPerExtra: number };
  maxInventory: number;
  enhance: {
    maxLevel: number;
    powerPerLevel: number;
    successRate: number[];
    cost: Record<string, number>;
    levelGrowth: number;
    gradeGrowth: number;
  };
  fusion: {
    chance: Record<string, number>;
    cost: Record<string, number>;
    failRefundRatio: number;
  };
}>('equipment.json');
export const pvpConfig = load<{
  cpRangeMin: number;
  cpRangeMax: number;
  cooldownSec: number;
  protectionHours: number;
  plunderRatio: number;
  protectedBase: number;
  protectedPerWarehouseLevel: number;
  maxTargets: number;
}>('pvp_config.json');
export const exploration = load<ExplorationData>('exploration.json');

export interface QuestGoal {
  types?: string[];
  detail?: string;
  state?: 'territoryLevel';
  count: number;
}
export interface QuestDef {
  id: string;
  goal: QuestGoal;
  reward: Record<string, number>;
}
export const questsData = load<{
  dayOffsetHours: number;
  rewardScalePerLevel: number;
  tutorial: QuestDef[];
  daily: QuestDef[];
  dailyBonus: { reward: Record<string, number> };
  attendance: { day: number; reward: Record<string, number> }[];
}>('quests.json');
export const raidsData = load<{
  intervalHours: number;
  intervalJitter: number;
  minTerritoryLevel: number;
  strengthRatio: [number, number];
  minStrength: number;
  config: { winnerLossRatio: number; loserLossRatio: number; drawLossRatio: number };
  raiderByLevel: { fromLevel: number; unitId: string }[];
  plunderRatio: number;
  rewardPerCP: Record<string, number>;
  /** 침공 방어 승리 시 가속(분) */
  winSpeedupMin: number;
}>('raids.json');
export const dungeonData = load<{
  minTerritoryLevel: number;
  dailyEntries: number;
  maxFloors: number;
  baseCP: number;
  cpGrowth: number;
  enemyByFloor: { fromFloor: number; unitId: string }[];
  floorReward: Record<string, number>;
  rewardGrowthPerFloor: number;
  levelScalePerLevel: number;
  milestones: { speedupEvery: number; speedupMinPerStep: number; equipmentEvery: number };
}>('dungeon.json');
export const guildData = load<{
  minTerritoryLevel: number;
  createCost: Record<string, number>;
  nameLength: { min: number; max: number };
  noticeMaxLength: number;
  baseMembers: number;
  membersPerLevel: number;
  levelExp: number[];
  expPerValue: number;
  dailyDonateValueLimit: number;
  buffPerLevel: { production: number; combat: number };
  listLimit: number;
}>('guild.json');
export const guildBossData = load<{
  durationHours: number;
  summonCooldownHours: number;
  ticketsPerDay: number;
  hpMultiplier: number;
  lossRatio: number;
  damageJitter: [number, number];
  lostRewardRatio: number;
  tiers: {
    id: string;
    minGuildLevel: number;
    hpFloor: number;
    reward: Record<string, number>;
    speedupMin: number;
    guildExp: number;
    topEquipment: number;
  }[];
}>('guild_boss.json');
export const marketData = load<{
  values: Record<string, number>;
  baseFee: number;
  feePerLevel: number;
  minFee: number;
  dailyVolumePerLevel: number;
}>('market.json');
export interface TechDef {
  id: string;
  effect: 'production' | 'train' | 'combat' | 'carry';
  perLevel: number;
  maxLevel: number;
  unlockLevel: number;
  cost: Record<string, number>;
  costGrowth: number;
  timeSec: number;
  timeGrowth: number;
}
export const researchData = load<{ techs: TechDef[] }>('research.json');

export const staticData: Record<string, unknown> = {
  races,
  units,
  buildings,
  territory_levels: territoryLevels,
  exploration,
  equipment: equipmentData,
  quests: questsData,
  market: marketData,
  research: researchData,
};
