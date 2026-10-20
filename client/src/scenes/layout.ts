/**
 * 영지 건물 배치: 영주관을 중심으로 타원 3겹에 건물이 놓인다.
 * 종류별 슬롯은 고정이라 건물이 늘어나도 기존 건물의 자리가 바뀌지 않는다.
 */
/**
 * 영지 건물 배치: 등각(아이소메트릭) 격자 마을.
 * 도로가 3칸마다 십자로 지나고, 도로 사이 구획(블록)의 칸이 건물 터가 된다. 영주관은 중앙 교차로.
 * 종류별 슬롯은 고정이라 건물이 늘어나도 기존 건물의 자리가 바뀌지 않는다.
 */
export const TILE_W = 112; // 칸(마름모) 가로
export const TILE_H = 56; // 칸 세로
export const CENTER_X = 480;
export const CENTER_Y = 322;
/** 격자 범위: i, j 모두 -GRID..GRID (이 안쪽에 도로·건물 터가 있다) */
export const GRID = 4;

/** 격자 좌표(i, j) → 화면 좌표. i 는 오른쪽 아래, j 는 왼쪽 아래 방향 */
export const isoToScreen = (i: number, j: number): [number, number] => [
  Math.round(CENTER_X + ((i - j) * TILE_W) / 2),
  Math.round(CENTER_Y + ((i + j) * TILE_H) / 2),
];

/** 도로 칸인지: 3칸마다(0, ±3) 가로·세로 도로 */
export const isRoad = (i: number, j: number): boolean => i % 3 === 0 || j % 3 === 0;

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

// 건물 터 후보: 격자 안의 도로가 아닌 칸. 영주관에 가까운 칸부터 순서대로 슬롯이 된다
const LOTS: { i: number; j: number }[] = [];
for (let i = -GRID; i <= GRID; i++) {
  for (let j = -GRID; j <= GRID; j++) {
    // 영주관 둘레 4칸(±1,±1)은 건물에 가려지거나 영주관을 가리므로 건물 터로 쓰지 않고 정원으로 꾸민다
    if (!isRoad(i, j) && !(Math.abs(i) === 1 && Math.abs(j) === 1)) LOTS.push({ i, j });
  }
}
LOTS.sort(
  (p, q) =>
    p.i * p.i + p.j * p.j - (q.i * q.i + q.j * q.j) || Math.atan2(p.j, p.i) - Math.atan2(q.j, q.i),
);

/** 슬롯 좌표 (ORDER 와 같은 순서) + 마지막(영주관) */
export const SLOT_POS: [number, number][] = ORDER.map((_, n) => isoToScreen(LOTS[n].i, LOTS[n].j));
/** 슬롯 격자 좌표 (바닥 그림 용) */
export const SLOT_TILES: [number, number][] = ORDER.map((_, n) => [LOTS[n].i, LOTS[n].j]);
/** 쓰지 않는 남는 터 (장식용) */
export const FREE_TILES: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  ...LOTS.slice(ORDER.length).map((l): [number, number] => [l.i, l.j]),
];
const HALL_SLOT = SLOT_POS.length;
SLOT_POS.push(isoToScreen(0, 0));

/** (종류, 순번) 에 해당하는 슬롯 번호. 없으면 null */
export function slotOf(type: string, index: number): number | null {
  if (type === 'town_hall') return index === 0 ? HALL_SLOT : null;
  const i = ORDER.findIndex(([t, n]) => t === type && n === index);
  return i >= 0 ? i : null;
}
