import { db } from '../db/db.js';
import { equipmentData } from '../data.js';
import { rollGrade, rollPower } from './equipmentRoll.js';

export interface GrantedItem {
  type: string;
  grade: string;
  power: number;
}

/** 무작위 종류의 장비를 즉시 지급한다 (퀘스트/출석/탐험 이벤트 보상). 인벤토리가 가득 차면 null. */
export function grantRandomEquipment(
  characterId: number,
  raceId: string,
  rng: () => number = Math.random,
): GrantedItem | null {
  const owned = (
    db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE character_id = ?').get(characterId) as {
      n: number;
    }
  ).n;
  if (owned >= equipmentData.maxInventory) return null;
  const type = equipmentData.types[Math.floor(rng() * equipmentData.types.length)].id;
  const grade = rollGrade(raceId, rng);
  const power = rollPower(raceId, grade, rng);
  db.prepare(
    'INSERT INTO equipment (character_id, type, grade, power, equipped, created_at) VALUES (?,?,?,?,0,?)',
  ).run(characterId, type, grade, power, Date.now());
  return { type, grade, power };
}

export function inventoryFull(characterId: number): boolean {
  const owned = (
    db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE character_id = ?').get(characterId) as {
      n: number;
    }
  ).n;
  return owned >= equipmentData.maxInventory;
}
