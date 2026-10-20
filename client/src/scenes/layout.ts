/**
 * 영지 건물 배치: 영주관을 중심으로 타원 3겹에 건물이 놓인다.
 * 종류별 슬롯은 고정이라 건물이 늘어나도 기존 건물의 자리가 바뀌지 않는다.
 */
const CENTER_X = 480;
const CENTER_Y = 305;

export const RINGS = [
  { n: 6, a: 185, b: 112, start: -60 },
  { n: 11, a: 320, b: 176, start: -95 },
  { n: 12, a: 440, b: 222, start: -80 },
] as const;

/** 슬롯 순서: [건물 종류, 몇 번째 건물인지]. 영주관은 중앙 고정 */
const ORDER: [string, number][] = [
  // 안쪽 고리 (6)
  ['barracks', 0],
  ['smithy', 0],
  ['market', 0],
  ['lab', 0],
  ['warehouse', 0],
  ['warehouse', 1],
  // 가운데 고리 (11)
  ['farm', 0],
  ['farm', 1],
  ['farm', 2],
  ['farm', 3],
  ['lumber_camp', 0],
  ['lumber_camp', 1],
  ['lumber_camp', 2],
  ['lumber_camp', 3],
  ['warehouse', 2],
  ['quarry', 0],
  ['quarry', 1],
  // 바깥 고리 (12)
  ['quarry', 2],
  ['quarry', 3],
  ['mine', 0],
  ['mine', 1],
  ['mine', 2],
  ['mine', 3],
  ['house', 0],
  ['house', 1],
  ['house', 2],
  ['house', 3],
  ['house', 4],
  ['house', 5],
];

/** 슬롯 좌표 (ORDER 와 같은 순서) + 마지막(영주관) */
export const SLOT_POS: [number, number][] = [];
for (const ring of RINGS) {
  for (let i = 0; i < ring.n; i++) {
    const ang = ((ring.start + (360 / ring.n) * i) * Math.PI) / 180;
    SLOT_POS.push([
      Math.round(CENTER_X + Math.cos(ang) * ring.a),
      Math.round(CENTER_Y + Math.sin(ang) * ring.b),
    ]);
  }
}
const HALL_SLOT = SLOT_POS.length;
SLOT_POS.push([CENTER_X, CENTER_Y + 20]);

/** (종류, 순번) 에 해당하는 슬롯 번호. 없으면 null */
export function slotOf(type: string, index: number): number | null {
  if (type === 'town_hall') return index === 0 ? HALL_SLOT : null;
  const i = ORDER.findIndex(([t, n]) => t === type && n === index);
  return i >= 0 ? i : null;
}
