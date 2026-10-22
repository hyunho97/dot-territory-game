import { assetUrl } from '../assetUrl';
import Phaser from 'phaser';
import type { BuildingData, CharacterState, UnitData } from '../api/client';
import { t } from '../i18n';
import { buildingSpriteKey } from '../ui/buildingSprite';
import {
  CENTER_X,
  CENTER_Y,
  HALL_RESERVE,
  TILE_H,
  TILE_W,
  WORLD_H,
  WORLD_W,
  autoSpot,
  fits,
  isoToScreen,
  screenToIso,
} from './layout';
import type { Rect } from './layout';

// 화면(뷰)의 논리 크기. 가로/세로 모드에 따라 다르다.
const WIDTH = 960;
const HEIGHT = 600;
const ZOOM = 2; // 실제 캔버스 해상도 배율
const GROUND_SCALE = 1.5; // 바닥 그림 해상도 배율 (너무 크면 일부 기기에서 못 만든다)
const MAX_IMAGE_LEVEL = 10;

export interface TerritoryInit {
  character: CharacterState;
  buildingData: BuildingData[];
  units: UnitData[];
  manifest: Record<string, string>;
  spriteTiers: number[];
  /** 건물 이미지를 클릭했을 때 (건설/업그레이드 창 열기). 빈 터를 눌렀으면 그 자리(spot)도 함께 */
  onBuildingClick?: (type: string, spot?: { x: number; y: number }) => void;
  /** 새 건물을 고른 칸에 짓는다. 실패하면 사유 문구를 돌려준다 */
  onPlaceBuilding?: (type: string, x: number, y: number) => Promise<string | null>;
  /** 튜토리얼 진행 중: 건물 이동처럼 안내 밖의 조작을 숨긴다 */
  tutorialActive?: boolean;
  /** 건물 이동 */
  onMoveBuilding?: (buildingId: number, x: number, y: number) => Promise<string | null>;
  /** 화면에 표시 중이던 건설/업그레이드 타이머가 끝났을 때 (서버 상태를 다시 받아 오기 위함) */
  onTimerDone?: () => void;
  /** 튜토리얼 등에서 강조할 건물 종류 */
  highlightType?: string | null;
}

const TEXT_STYLE = {
  fontFamily: 'DotGothic16, monospace',
  fontSize: '16px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 4,
  resolution: 2, // 글자를 또렷하게
};

/** 영지 id: 종족 + 레벨(1~10)에 대응하는 영지 전경 이미지 키. 예) territory/human_03 */
export function territoryImageKey(race: string, level: number): string {
  const lv = Math.min(Math.max(level, 1), MAX_IMAGE_LEVEL);
  return `territory/${race}_${String(lv).padStart(2, '0')}`;
}

const fmt = (sec: number): string => {
  const s = Math.max(0, Math.ceil(sec));
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${p(hh)}:${p(mm)}` : `${p(hh)}:${p(mm)}:${p(ss)}`;
};

/** 종족별 바닥 색: 잔디 밝은색/어두운색, 길(흙)색, 점 장식색 */
const GROUND: Record<
  string,
  { light: string; dark: string; path: string; dots: string[]; leaf: [string, string] }
> = {
  human: {
    light: '#6f9a4a',
    dark: '#4f7a38',
    path: '#a58a5c',
    dots: ['#f2e27a', '#ffffff', '#e87a8a'],
    leaf: ['#2f6a2e', '#4e9a3c'],
  },
  elf: {
    light: '#5a9a5e',
    dark: '#3a7448',
    path: '#8d9a6a',
    dots: ['#b9f2c8', '#fff2a8', '#c8a8f2'],
    leaf: ['#1f5a3c', '#3f9a5a'],
  },
  dwarf: {
    light: '#7d7468',
    dark: '#5a5248',
    path: '#9c8468',
    dots: ['#c8b89a', '#8a8070', '#d89a4a'],
    leaf: ['#2a4a38', '#47705a'],
  },
  undead: {
    light: '#555a66',
    dark: '#383c4a',
    path: '#6e6a7e',
    dots: ['#7ae8e8', '#9aa0b4', '#b8a8d8'],
    leaf: ['#2b2733', '#4a4458'],
  },
  orc: {
    light: '#7e8a48',
    dark: '#5c6a34',
    path: '#9a7a4e',
    dots: ['#d86a3a', '#c8b078', '#a8442a'],
    leaf: ['#4a5a24', '#7a8a3a'],
  },
};

/** 간단한 시드 난수: 같은 종족이면 늘 같은 바닥 무늬 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 두 색(#rrggbb)을 t 비율로 섞는다 */
function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, k: number): number => parseInt(h.slice(1 + k * 2, 3 + k * 2), 16);
  const c = (k: number): number => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * t);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

/** 등각 칸(마름모) 하나를 칠한다 (이음매가 안 보이게 살짝 크게) */
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, grow = 1): void {
  const w = TILE_W / 2 + grow;
  const h = TILE_H / 2 + grow / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x - w, y);
  ctx.closePath();
}

/** 나무 한 그루 (종족별 모양: 엘프·드워프=침엽수, 언데드=마른 나무, 그 외=활엽수) */
function drawTree(
  ctx: CanvasRenderingContext2D,
  race: string,
  x: number,
  y: number,
  k: number,
  g: { leaf: [string, string] },
): void {
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y, 16 * k, 6 * k, 0, 0, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (race === 'undead') {
    ctx.strokeStyle = '#2b2733';
    ctx.lineWidth = 4 * k;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 40 * k);
    ctx.moveTo(x, y - 24 * k);
    ctx.lineTo(x - 14 * k, y - 38 * k);
    ctx.moveTo(x, y - 30 * k);
    ctx.lineTo(x + 12 * k, y - 46 * k);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = '#4a3322';
  ctx.fillRect(x - 3 * k, y - 16 * k, 6 * k, 16 * k);
  if (race === 'elf' || race === 'dwarf') {
    for (let n = 0; n < 3; n++) {
      ctx.fillStyle = n === 2 ? g.leaf[1] : g.leaf[0];
      ctx.beginPath();
      ctx.moveTo(x, y - (52 - n * 0) * k + n * 14 * k - 8 * k);
      ctx.lineTo(x + (22 - n * 3) * k, y - 14 * k + n * 2 * k - (2 - n) * 8 * k);
      ctx.lineTo(x - (22 - n * 3) * k, y - 14 * k + n * 2 * k - (2 - n) * 8 * k);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    for (const [dx, dy, r, c] of [
      [-9, -26, 13, g.leaf[0]],
      [9, -26, 13, g.leaf[0]],
      [0, -36, 15, g.leaf[1]],
    ] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x + dx * k, y + dy * k, r * k, 0, 7);
      ctx.fill();
    }
  }
}

/** 마을 바닥(등각 칸: 내 땅·광장·길)과 둘레 숲을 캔버스로 직접 그린다. S 는 그림 해상도 배율 */
function drawGround(
  tex: Phaser.Textures.CanvasTexture,
  race: string,
  R: number,
  rects: Rect[],
  S: number,
): void {
  const g = GROUND[race] ?? GROUND.human;
  const ctx = tex.getContext();
  ctx.setTransform(S, 0, 0, S, 0, 0);
  const rand = rng([...race].reduce((n, c) => n * 31 + c.charCodeAt(0), 7));
  ctx.fillStyle = g.dark;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // ── 길 찾기: 광장 둘레 + 각 건물에서 가장 가까운 길까지 (건물을 옮기면 길도 따라 바뀐다) ──
  const key = (i: number, j: number): string => `${i},${j}`;
  const inLand = (i: number, j: number): boolean => Math.abs(i) <= R && Math.abs(j) <= R;
  const blocked = new Set<string>();
  const block = (r: Rect): void => {
    for (let i = r.i; i < r.i + r.n; i++)
      for (let j = r.j; j < r.j + r.n; j++) blocked.add(key(i, j));
  };
  rects.forEach(block);
  block(HALL_RESERVE);
  const free = (i: number, j: number): boolean => inLand(i, j) && !blocked.has(key(i, j));
  const road = new Set<string>();
  for (let i = -3; i <= 2; i++)
    for (let j = -3; j <= 2; j++)
      if ((i === -3 || i === 2 || j === -3 || j === 2) && free(i, j)) road.add(key(i, j));
  const DIRS: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const byDist = [...rects].sort(
    (a, b) => Math.hypot(a.i + a.n / 2, a.j + a.n / 2) - Math.hypot(b.i + b.n / 2, b.j + b.n / 2),
  );
  for (const r of byDist) {
    const starts: [number, number][] = [];
    for (let i = r.i - 1; i <= r.i + r.n; i++)
      for (let j = r.j - 1; j <= r.j + r.n; j++) {
        const edge = (i === r.i - 1 || i === r.i + r.n) !== (j === r.j - 1 || j === r.j + r.n);
        if (edge && free(i, j)) starts.push([i, j]);
      }
    if (starts.some(([i, j]) => road.has(key(i, j)))) continue;
    const parent = new Map<string, string | null>();
    const queue: [number, number][] = [];
    for (const [i, j] of starts) {
      parent.set(key(i, j), null);
      queue.push([i, j]);
    }
    let hit: string | null = null;
    for (let qi = 0; qi < queue.length && !hit; qi++) {
      const [ci, cj] = queue[qi];
      for (const [di, dj] of DIRS) {
        const ni = ci + di;
        const nj = cj + dj;
        const k = key(ni, nj);
        if (parent.has(k) || !free(ni, nj)) continue;
        parent.set(k, key(ci, cj));
        if (road.has(k)) {
          hit = k;
          break;
        }
        queue.push([ni, nj]);
      }
    }
    for (let k: string | null | undefined = hit; k; k = parent.get(k)) road.add(k);
    for (const [i, j] of starts.slice(0, 1)) road.add(key(i, j));
  }

  // ── 칸 그리기 ──
  const trees: { x: number; y: number; k: number }[] = [];
  const RANGE = 28;
  const inHall = (i: number, j: number): boolean =>
    i >= HALL_RESERVE.i &&
    i < HALL_RESERVE.i + HALL_RESERVE.n &&
    j >= HALL_RESERVE.j &&
    j < HALL_RESERVE.j + HALL_RESERVE.n;
  for (let i = -RANGE; i <= RANGE; i++) {
    for (let j = -RANGE; j <= RANGE; j++) {
      const [x, y] = isoToScreen(i, j);
      if (x < -TILE_W || x > WORLD_W + TILE_W || y < -TILE_H || y > WORLD_H + TILE_H) continue;
      const land = inLand(i, j);
      const plaza = land && inHall(i, j);
      const isRoad = land && road.has(key(i, j));
      ctx.globalAlpha = 1;
      ctx.fillStyle = plaza
        ? mixHex(g.path, g.light, 0.35)
        : isRoad
          ? g.path
          : mixHex(g.dark, g.light, (land ? 0.55 : 0.3) + rand() * 0.18);
      diamond(ctx, x, y);
      ctx.fill();
      ctx.globalAlpha = 0.03 + rand() * 0.05;
      ctx.fillStyle = rand() < 0.5 ? '#fff' : '#000';
      diamond(ctx, x, y, 0);
      ctx.fill();
      if (plaza || isRoad) {
        ctx.globalAlpha = plaza ? 0.22 : 0.3;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        diamond(ctx, x, y, -1);
        ctx.stroke();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#fff';
        for (let n = 0; n < 5; n++)
          ctx.fillRect(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 24, 3, 2);
      } else {
        if (land) {
          // 내 땅: 얇은 칸 테두리
          ctx.globalAlpha = 0.14;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          diamond(ctx, x, y, -1);
          ctx.stroke();
        }
        for (let n = 0; n < 6; n++) {
          const px = x + (rand() - 0.5) * 70;
          const py = y + (rand() - 0.5) * 28;
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = rand() < 0.15 ? g.dots[Math.floor(rand() * g.dots.length)] : g.light;
          ctx.fillRect(px, py, 2, rand() < 0.15 ? 2 : 4);
        }
        // 내 땅 바깥은 숲
        // (땅 바로 바깥 한 칸은 나무 없이 비워 울타리가 숲에 묻히지 않게 한다)
        if (!land && Math.max(Math.abs(i), Math.abs(j)) > R + 1 && rand() < 0.55)
          trees.push({ x: x + (rand() - 0.5) * 30, y, k: 0.9 + rand() * 0.5 });
      }
    }
  }
  trees.sort((p, q) => p.y - q.y);
  for (const tr of trees) drawTree(ctx, race, tr.x, tr.y, tr.k, g);

  // ── 땅 경계: 울타리 ──
  const corner = (si: number, sj: number): [number, number] =>
    isoToScreen(si * (R + 0.5), sj * (R + 0.5));
  const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  ctx.globalAlpha = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#3a2a18';
  ctx.lineWidth = 7;
  ctx.beginPath();
  pts.forEach(([x, y], n) => (n === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = '#a07a48';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // 울타리 기둥
  ctx.fillStyle = '#6b4a2a';
  for (let n = 0; n < 4; n++) {
    const [ax, ay] = pts[n];
    const [bx, by] = pts[(n + 1) % 4];
    const steps = R * 2 + 1;
    for (let s = 0; s < steps; s++) {
      const px = ax + ((bx - ax) * s) / steps;
      const py = ay + ((by - ay) * s) / steps;
      ctx.fillRect(px - 2.5, py - 11, 5, 12);
    }
  }

  // 가장자리 어둡게(비네팅)
  const vg = ctx.createRadialGradient(CENTER_X, CENTER_Y, 420, CENTER_X, CENTER_Y, 1150);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  tex.refresh();
}

/** 전경 일러스트에서 그림이 있는 영역(배경색과 다른 부분)의 범위와 배경색을 찾는다 */
function artBounds(img: HTMLImageElement): {
  x: number;
  y: number;
  w: number;
  h: number;
  bg: number;
} {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const full = { x: 0, y: 0, w: img.width, h: img.height, bg: 0x15151d };
  if (!ctx) return full;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const px = (x: number, y: number): [number, number, number] => {
    const i = (y * c.width + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const corners = [
    px(2, 2),
    px(c.width - 3, 2),
    px(2, c.height - 3),
    px(c.width - 3, c.height - 3),
  ];
  const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((a, v) => a + v[k], 0) / 4));
  let x0 = c.width;
  let y0 = c.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      const [r, g, b] = px(x, y);
      if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 60) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return full;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, bg: (bg[0] << 16) | (bg[1] << 8) | bg[2] };
}

/**
 * 영지 메인 화면. 영주관을 중심으로 건물이 격자 마을처럼 놓이고, 건물을 클릭하면 건설/업그레이드 창이 열린다.
 * 영지 레벨이 오르면 땅(울타리 안쪽)이 넓어지고, 건물은 레벨이 오르면 커진다. "건물 이동"으로 자리를 바꿀 수 있다.
 * "전경 보기" 버튼으로 영지 전경 일러스트를 크게 볼 수 있다.
 */
export class TerritoryScene extends Phaser.Scene {
  private init_!: TerritoryInit;
  private imageKey = '';
  private initWall = 0;
  private doneSignaled = false;
  private timers: { text: Phaser.GameObjects.Text; finishAt: number; prefix: string }[] = [];
  // 아래 값들은 건물을 짓거나 옮겨 화면이 다시 그려져도 유지된다
  private moveMode = false;
  private moveSelected: number | null = null;
  /** 새 건물을 놓을 자리를 고르는 중이면 그 건물 종류 */
  private placing: string | null = null;
  private view: { x: number; y: number; z: number; r: number } | null = null;

  constructor() {
    super('Territory');
  }

  init(data: TerritoryInit): void {
    this.init_ = data;
    this.timers = [];
    this.doneSignaled = false;
    this.initWall = Date.now();
  }

  /** 건설 창에서 [건설]을 누르면: 지을 자리를 직접 고르는 모드로 들어간다 */
  beginPlacement(type: string): void {
    this.placing = type;
    this.moveMode = false;
    this.moveSelected = null;
    this.scene.restart(this.init_);
  }

  preload(): void {
    const { character, manifest, units, spriteTiers, buildingData } = this.init_;
    this.imageKey = territoryImageKey(character.race, character.territoryLevel);
    const needed = new Set<string>([this.imageKey, 'buildings/under_construction']);
    for (const s of character.units) {
      const def = units.find((u) => u.id === s.unitId);
      if (def) needed.add(def.sprite);
    }
    for (const b of character.buildings) {
      const lv = b.type === 'town_hall' ? character.territoryLevel : b.level;
      const key = buildingSpriteKey(manifest, spriteTiers, character.race, b.type, lv);
      if (key) needed.add(key);
    }
    // 아직 안 지은 건물(건설 가능한 것)의 이미지도 흐리게 보여 주므로 미리 로드
    for (const d of buildingData) {
      if (!d.buildable || d.unlockLevel > character.territoryLevel) continue;
      const key = buildingSpriteKey(manifest, spriteTiers, character.race, d.id, 1);
      if (key) needed.add(key);
    }
    for (const id of needed) {
      if (manifest[id]) this.load.image(id, assetUrl(manifest[id]));
    }
  }

  private nowMs(): number {
    return this.init_.character.serverNow + (Date.now() - this.initWall);
  }

  create(): void {
    const { character, buildingData, units, manifest, spriteTiers } = this.init_;
    const has = (k: string): boolean => this.textures.exists(k);
    // 캔버스는 논리 크기의 ZOOM 배로 만들고 카메라를 확대해, 화면에 맞춰 줄어들어도 글자가 또렷하다
    const vw = this.scale.width / ZOOM; // 화면(뷰) 논리 크기
    const vh = this.scale.height / ZOOM;
    this.cameras.main.setOrigin(0, 0).setZoom(ZOOM);
    const R = character.landRadius;
    const TOP = 44;
    const BOTTOM = 70;

    // ── 세계: 바닥 + 건물. 끌어서 이동하고 휠/버튼으로 확대·축소한다 (영지 HUD 는 세계 밖에 둔다) ──
    const world = this.add.container(0, 0);
    const clampView = (): void => {
      const z = world.scaleX;
      const w = WORLD_W * z;
      const h = WORLD_H * z;
      world.x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, world.x));
      world.y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, world.y));
      this.view = { x: world.x, y: world.y, z, r: R };
    };
    {
      // 처음에는 땅 전체가 보이도록 맞춘다 (이전 확대/위치가 있고 땅이 그대로면 유지)
      const landW = (2 * R + 1) * TILE_W;
      const landH = (2 * R + 1) * TILE_H + 130;
      const z0 = Math.min(
        1.25,
        Math.max(0.4, Math.min((vw * 0.96) / landW, (vh - TOP - BOTTOM) / landH)),
      );
      if (this.view && this.view.r === R) {
        world.setScale(this.view.z).setPosition(this.view.x, this.view.y);
      } else {
        world.setScale(z0);
        world.x = vw / 2 - CENTER_X * z0;
        world.y = TOP + (vh - TOP - BOTTOM) / 2 - (CENTER_Y + 10) * z0;
      }
      clampView();
    }
    const zoomAt = (sx: number, sy: number, factor: number): void => {
      const z = world.scaleX;
      const nz = Math.min(1.8, Math.max(0.4, z * factor));
      world.x = sx - ((sx - world.x) * nz) / z;
      world.y = sy - ((sy - world.y) * nz) / z;
      world.setScale(nz);
      clampView();
    };
    // 창(모달)이 떠 있는 동안에는 그 밑의 영지 화면이 클릭·드래그·휠로 반응하지 않게 한다
    const modalOpen = (): boolean => !!document.querySelector('.modal-overlay');
    // 화면 고정 버튼(HUD)인지: 건물 그림의 투명한 부분이 칸 선택을 가로채지 않게 구분한다
    const isHud = (o: unknown): boolean =>
      (o as Phaser.GameObjects.Components.ScrollFactor).scrollFactorX === 0;
    let dragged = false;
    let last: { x: number; y: number } | null = null;
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (modalOpen()) return;
      dragged = false;
      last = { x: ptr.x, y: ptr.y };
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (modalOpen() || !ptr.isDown || !last) return;
      if (!dragged && Math.hypot(ptr.x - ptr.downX, ptr.y - ptr.downY) < 10) return;
      dragged = true;
      world.x += (ptr.x - last.x) / ZOOM;
      world.y += (ptr.y - last.y) / ZOOM;
      last = { x: ptr.x, y: ptr.y };
      clampView();
    });
    this.input.on('wheel', (ptr: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!modalOpen()) zoomAt(ptr.x / ZOOM, ptr.y / ZOOM, dy > 0 ? 0.9 : 1.1);
    });
    const toWorld = (ptr: Phaser.Input.Pointer): [number, number] => [
      (ptr.x / ZOOM - world.x) / world.scaleX,
      (ptr.y / ZOOM - world.y) / world.scaleX,
    ];

    // ── 배치 정보 ──
    const blds = character.buildings.filter((b) => b.type !== 'town_hall');
    const rectsExcept = (exceptId: number | null): Rect[] =>
      blds.filter((b) => b.id !== exceptId).map((b) => ({ i: b.x, j: b.y, n: b.reserve }));

    // ── 바닥: 종족별 색의 잔디·광장·길 + 둘레 숲 ──
    const groundTex = this.textures.createCanvas(
      `ground_${Date.now()}`,
      Math.round(WORLD_W * GROUND_SCALE),
      Math.round(WORLD_H * GROUND_SCALE),
    );
    if (groundTex) {
      drawGround(groundTex, character.race, R, rectsExcept(null), GROUND_SCALE);
      world.add(this.add.image(WORLD_W / 2, WORLD_H / 2, groundTex).setScale(1 / GROUND_SCALE));
    } else {
      world.add(this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x2c4a2a));
    }
    const bars = this.add.graphics().setScrollFactor(0).setDepth(4);
    bars.fillStyle(0x000000, 0.22);
    bars.fillRect(0, 0, vw, TOP); // 상단 여백
    bars.fillRect(0, vh - BOTTOM, vw, BOTTOM); // 하단 병력 띠

    // 아래 HUD 를 만든 뒤 채워지는 함수들 (건물 클릭 처리에서 미리 쓰이므로 먼저 선언)
    let refreshHint: () => void = () => undefined;
    let flash: (msg: string) => void = () => undefined;

    // ── 이동 모드 표시: 놓을 수 있는 칸, 고른 건물, 놓을 자리 미리보기 ──
    const gridG = this.add.graphics();
    const selG = this.add.graphics();
    const previewG = this.add.graphics();
    const diamondPts = (r: Rect, shrink = 1): Phaser.Geom.Point[] => {
      const [cx, cy] = isoToScreen(r.i + (r.n - 1) / 2, r.j + (r.n - 1) / 2);
      const dw = ((r.n * TILE_W) / 2) * shrink;
      const dh = ((r.n * TILE_H) / 2) * shrink;
      return [
        new Phaser.Geom.Point(cx, cy - dh),
        new Phaser.Geom.Point(cx + dw, cy),
        new Phaser.Geom.Point(cx, cy + dh),
        new Phaser.Geom.Point(cx - dw, cy),
      ];
    };
    const sizeOfSelected = (): number => blds.find((b) => b.id === this.moveSelected)?.reserve ?? 1;
    // "+" 건설 터들: 이동 모드에서는 숨겨서 놓을 칸 선택을 가리지 않게 한다
    const ghostObjs: Phaser.GameObjects.GameObject[] = [];
    let target: { i: number; j: number; ok: boolean } | null = null;
    const redrawMoveMarks = (): void => {
      gridG.clear();
      selG.clear();
      previewG.clear();
      const editing = this.moveMode || this.placing !== null;
      gridG.setVisible(editing);
      for (const o of ghostObjs) (o as Phaser.GameObjects.Image).setVisible(!editing);
      if (!editing) return;
      const others = rectsExcept(this.placing ? null : this.moveSelected);
      const n = this.placing || this.moveSelected === null ? 1 : sizeOfSelected();
      for (let i = -R; i <= R; i++)
        for (let j = -R; j <= R; j++) {
          if (!fits(R, { i, j, n: 1 }, others)) continue;
          const pts = diamondPts({ i, j, n: 1 }, 0.96);
          gridG.fillStyle(0x7cfc9a, 0.13).fillPoints(pts, true);
          gridG.lineStyle(1, 0xffffff, 0.22).strokePoints(pts, true);
        }
      const sel = blds.find((b) => b.id === this.moveSelected);
      if (sel) {
        selG
          .lineStyle(3, 0x4fd8ff, 1)
          .strokePoints(diamondPts({ i: sel.x, j: sel.y, n: sel.reserve }, 1), true);
        selG
          .fillStyle(0x4fd8ff, 0.18)
          .fillPoints(diamondPts({ i: sel.x, j: sel.y, n: sel.reserve }, 1), true);
      }
      if (target && (sel || this.placing)) {
        const pts = diamondPts({ i: target.i, j: target.j, n }, 1);
        previewG.fillStyle(target.ok ? 0x3be07a : 0xff4d4d, 0.4).fillPoints(pts, true);
        previewG.lineStyle(3, target.ok ? 0x3be07a : 0xff4d4d, 1).strokePoints(pts, true);
      }
    };

    // ── 건물 레이어 ──
    const layer = this.add.container(0, 0);
    // 건물 이름표(마우스를 올렸을 때만 보임)는 모든 건물보다 위에 그린다
    const overlay = this.add.container(0, 0);
    world.add([gridG, layer, selG, previewG, overlay]);

    const placeSprite = (
      type: string,
      level: number,
      rect: Rect,
      opts: { ghost?: boolean; b?: CharacterState['buildings'][number] },
    ): void => {
      // 건물이 차지한 칸(n×n)의 가운데가 마름모의 가운데. 그림 크기는 칸 너비에 딱 맞춘다.
      const [cx, cy] = isoToScreen(rect.i + (rect.n - 1) / 2, rect.j + (rect.n - 1) / 2);
      const size = rect.n * TILE_W * 0.95;
      const x = cx;
      const y = cy; // 건물 바닥이 터 한가운데에 닿도록 (이전엔 위로 떠 보였다)
      const key = buildingSpriteKey(manifest, spriteTiers, character.race, type, level);
      if (key && has(key)) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
      const hits: Phaser.GameObjects.GameObject[] = [];
      let img: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
      if (key && has(key)) {
        img = this.add.image(x, y, key).setDisplaySize(size, size);
        (img as Phaser.GameObjects.Image).setOrigin(0.5, 0.7);
      } else {
        const color = buildingData.find((d) => d.id === type)?.color ?? '#888888';
        img = this.add
          .rectangle(
            x,
            y - size * 0.2,
            size * 0.6,
            size * 0.6,
            Phaser.Display.Color.HexStringToColor(color).color,
          )
          .setStrokeStyle(2, 0x000000);
      }
      hits.push(img);
      // 건물이 서 있는 터(등각 마름모): 지은 건물은 돌 바닥, 빈 터는 금색 테두리
      const plot = this.add.graphics();
      const poly = diamondPts(rect, 0.98);
      const cxy = (k: number): Phaser.Geom.Point[] =>
        poly.map((q) => new Phaser.Geom.Point(cx + (q.x - cx) * k, cy + (q.y - cy) * k));
      // 건물이 땅에 닿은 느낌을 주는 접지 그림자(겹쳐 그려 가장자리를 부드럽게)
      if (!opts.ghost) {
        for (const [k, a] of [
          [0.78, 0.12],
          [0.58, 0.16],
          [0.4, 0.2],
        ] as const) {
          plot.fillStyle(0x000000, a).fillEllipse(cx, cy, rect.n * TILE_W * k, rect.n * TILE_H * k);
        }
      }
      if (opts.ghost) {
        plot.fillStyle(0xffffff, 0.12).fillPoints(poly, true);
        plot.lineStyle(2, 0xe8b830, 0.85).strokePoints(poly, true);
      } else {
        plot.fillStyle(0x000000, 0.22).fillPoints(poly, true);
        plot.fillStyle(0xb8b2a4, 0.5).fillPoints(cxy(0.9), true);
        plot.lineStyle(2, 0x000000, 0.35).strokePoints(poly, true);
      }
      layer.add(plot);
      layer.add(img);
      if (opts.ghost) ghostObjs.push(plot, img);

      const constructing = !!opts.b && opts.b.finishAt !== null && opts.b.finishAt > this.nowMs();
      const upgrading =
        !!opts.b && opts.b.upgradeFinishAt !== null && opts.b.upgradeFinishAt > this.nowMs();
      const smallText = { ...TEXT_STYLE, fontSize: '13px', strokeThickness: 3 };
      // 글자 뒤에 둥근 이름표를 깔아 어떤 바닥 위에서도 읽히게
      const pill = (tx: Phaser.GameObjects.Text, accent = 0x000000): void => {
        const bg = this.add.graphics();
        bg.fillStyle(accent, 0.4);
        bg.fillRoundedRect(
          tx.x - tx.width / 2 - 6,
          tx.y - tx.height / 2 - 1,
          tx.width + 12,
          tx.height + 2,
          8,
        );
        layer.add(bg);
        layer.add(tx);
      };
      let tipY = y;
      if (opts.ghost) {
        img.setAlpha(0.01); // 눌러서 건설할 자리: 흐릿한 건물 그림 대신 깔끔한 터 표시
        const badge = this.add
          .circle(x, y - size * 0.22, 17, 0x1a1428, 0.75)
          .setStrokeStyle(2, 0xe8b830);
        layer.add(badge);
        ghostObjs.push(badge);
        const plus = this.add
          .text(x, y - size * 0.22, '+', { ...TEXT_STYLE, fontSize: '26px', strokeThickness: 0 })
          .setOrigin(0.5);
        tipY = y - size * 0.62;
        layer.add(plus);
        ghostObjs.push(plus);
        this.tweens.add({ targets: plus, alpha: 0.5, yoyo: true, repeat: -1, duration: 900 });
        hits.push(plus);
      } else {
        if (constructing) img.setAlpha(0.55);
        const lvText = type === 'town_hall' ? level : (opts.b?.level ?? level);
        tipY = y - size * 0.9;
        // 건물 아래에는 레벨만 작게, 이름은 마우스를 올리면 위에 표시
        pill(
          this.add
            .text(x, cy + 4, `Lv.${lvText}`, {
              ...smallText,
              fontSize: '11px',
              strokeThickness: 2,
            })
            .setOrigin(0.5),
          0x1a1428,
        );
        if (constructing && has('buildings/under_construction')) {
          const uc = this.add
            .image(x, y - size * 0.42, 'buildings/under_construction')
            .setDisplaySize(40, 40);
          layer.add(uc);
          hits.push(uc);
        }
        const fin = constructing ? opts.b?.finishAt : upgrading ? opts.b?.upgradeFinishAt : null;
        if (fin) {
          const tx = this.add
            .text(x, y - size * 0.9, '', {
              ...smallText,
              fontSize: '13px',
              color: '#ffd54f',
            })
            .setOrigin(0.5);
          pill(tx, 0x3a2a08);
          this.timers.push({ text: tx, finishAt: fin, prefix: constructing ? '건설 ' : '강화 ' });
        }
      }
      // 클릭/호버
      const tipText = this.add
        .text(x, tipY, t(`building.${type}`), { ...smallText, fontSize: '14px' })
        .setOrigin(0.5);
      const tipBox = (g: Phaser.GameObjects.Graphics): Phaser.GameObjects.Graphics =>
        g
          .fillStyle(0x1a1428, 0.9)
          .fillRoundedRect(
            x - tipText.width / 2 - 8,
            tipY - tipText.height / 2 - 2,
            tipText.width + 16,
            tipText.height + 4,
            8,
          )
          .lineStyle(1, 0xe8b830, 0.9)
          .strokeRoundedRect(
            x - tipText.width / 2 - 8,
            tipY - tipText.height / 2 - 2,
            tipText.width + 16,
            tipText.height + 4,
            8,
          );
      const tip = this.add.container(0, 0, [tipBox(this.add.graphics()), tipText]);
      tip.setVisible(false);
      overlay.add(tip);
      for (const o of hits) {
        // 그림은 보이는(불투명) 부분만 눌리게 해서, 건물 옆 빈 칸을 가리지 않는다
        o.setInteractive(
          o instanceof Phaser.GameObjects.Image
            ? { useHandCursor: true, pixelPerfect: true, alphaTolerance: 40 }
            : { useHandCursor: true },
        );
        o.on('pointerup', () => {
          if (dragged || this.placing || modalOpen()) return;
          if (this.moveMode) {
            // 이동 모드: 지은 건물을 눌러 고른다 (영주관은 못 옮김)
            if (opts.ghost) return;
            if (type === 'town_hall') {
              flash(t('territory.hallFixed'));
              return;
            }
            this.moveSelected = opts.b?.id ?? null;
            target = null;
            redrawMoveMarks();
            refreshHint();
            return;
          }
          this.init_.onBuildingClick?.(type, opts.ghost ? { x: rect.i, y: rect.j } : undefined);
        });
        o.on('pointerover', () => {
          (img as Phaser.GameObjects.Image).setTint?.(0xffffcc);
          tip.setVisible(true);
        });
        o.on('pointerout', () => {
          (img as Phaser.GameObjects.Image).clearTint?.();
          tip.setVisible(false);
        });
      }
      if (this.init_.highlightType === type) {
        const ring = this.add.ellipse(x, cy, size * 0.95, size * 0.3).setStrokeStyle(3, 0xe8b830);
        layer.add(ring);
        this.tweens.add({
          targets: ring,
          scaleX: 1.25,
          scaleY: 1.25,
          alpha: 0.2,
          repeat: -1,
          duration: 900,
        });
      }
    };

    // 깊이: 화면 앞쪽(i+j 가 큰) 건물이 나중에 그려지도록 정렬해서 배치
    const items: { key: number; run: () => void }[] = [];
    for (const b of character.buildings) {
      const n = b.size;
      const level = b.type === 'town_hall' ? character.territoryLevel : b.level;
      items.push({
        key: b.x + b.y + 2 * (n - 1),
        run: () => placeSprite(b.type, level, { i: b.x, j: b.y, n }, { b }),
      });
    }
    // 아직 안 지은 건물은 영주관 가까운 빈 땅에 "+" 터로 표시한다
    // (서버의 자동 배치와 같은 규칙: 다 자랐을 때의 크기만큼 자리를 남긴다)
    const grow = character.growSize;
    const real = rectsExcept(null);
    const grown = blds.map((b) => ({ i: b.x, j: b.y, n: Math.max(b.reserve, grow) }));
    for (const d of buildingData) {
      if (!d.buildable || d.unlockLevel > character.territoryLevel) continue;
      if (blds.filter((b) => b.type === d.id).length >= d.maxCount) continue;
      const spot = autoSpot(R, grow, grown) ?? autoSpot(R, 1, real);
      if (!spot) continue;
      grown.push({ ...spot, n: grow });
      real.push({ ...spot, n: 1 });
      items.push({
        key: spot.i + spot.j,
        run: () => placeSprite(d.id, 1, { ...spot, n: 1 }, { ghost: true }),
      });
    }
    items.sort((a, c) => a.key - c.key).forEach((it) => it.run());

    // ── 이동 모드: 놓을 칸 고르기 ──
    const aimAt = (ptr: Phaser.Input.Pointer): void => {
      const sel = blds.find((b) => b.id === this.moveSelected);
      if (!this.placing && (!this.moveMode || !sel)) return;
      const [wx, wy] = toWorld(ptr);
      const [pi, pj] = screenToIso(wx, wy);
      const n = this.placing ? 1 : (sel?.reserve ?? 1);
      const i = Math.round(pi - (n - 1) / 2);
      const j = Math.round(pj - (n - 1) / 2);
      target = {
        i,
        j,
        ok: fits(R, { i, j, n }, rectsExcept(this.placing ? null : (sel?.id ?? null))),
      };
      redrawMoveMarks();
    };
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!ptr.isDown && !modalOpen()) aimAt(ptr);
    });
    this.input.on('pointerup', (ptr: Phaser.Input.Pointer, over: unknown[]) => {
      // 건물 그림은 칸 선택을 막지 않는다 (화면 고정 버튼 위에서만 무시)
      if (dragged || modalOpen() || over.some(isHud)) return;
      if (this.placing) {
        // 새 건물: 누른 칸에 짓는다
        aimAt(ptr);
        if (!target) return;
        if (!target.ok) {
          flash(t('territory.cannotPlace'));
          return;
        }
        const type = this.placing;
        const { i, j } = target;
        this.placing = null;
        target = null;
        refreshHint();
        redrawMoveMarks();
        void this.init_.onPlaceBuilding?.(type, i, j).then((err) => {
          if (!err) return;
          flash(err);
          this.placing = type; // 실패하면 다시 고르게 한다
          refreshHint();
          redrawMoveMarks();
        });
        return;
      }
      if (!this.moveMode || this.moveSelected === null) return;
      aimAt(ptr);
      const sel = blds.find((b) => b.id === this.moveSelected);
      if (!sel || !target) return;
      if (!target.ok) {
        flash(t('territory.cannotPlace'));
        return;
      }
      if (target.i === sel.x && target.j === sel.y) return;
      const { i, j } = target;
      void this.init_.onMoveBuilding?.(sel.id, i, j).then((err) => {
        if (err) flash(err);
      });
    });

    // ── 하단: 병력 띠 ──
    const troopLayer = this.add.container(0, 0).setScrollFactor(0).setDepth(4);
    let i = 0;
    for (const s of character.units) {
      const def = units.find((u) => u.id === s.unitId);
      const x = 44 + i * 78;
      const uy = vh - 36;
      if (def && has(def.sprite)) {
        const u = this.add.image(x, uy, def.sprite).setDisplaySize(56, 56);
        troopLayer.add(u);
        this.tweens.add({ targets: u, y: uy - 3, yoyo: true, repeat: -1, duration: 700 + i * 90 });
      } else {
        troopLayer.add(this.add.rectangle(x, uy, 30, 44, 0x888888).setStrokeStyle(3, 0x000000));
      }
      troopLayer.add(
        this.add
          .text(x + 14, uy + 14, `x${s.count}`, {
            ...TEXT_STYLE,
            fontSize: '13px',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      );
      i++;
    }

    // ── 전경 보기 토글 ──
    const pano = this.add.container(0, 0).setVisible(false).setDepth(5).setScrollFactor(0);
    if (has(this.imageKey)) {
      const tex = this.textures.get(this.imageKey);
      tex.setFilter(Phaser.Textures.FilterMode.LINEAR); // 확대해도 계단 없이 부드럽게
      const src = tex.getSourceImage() as HTMLImageElement;
      const art = artBounds(src);
      pano.add(this.add.rectangle(vw / 2, vh / 2, vw, vh, art.bg));
      // 그림이 있는 부분만 화면에 가득 차게 확대
      const scale = Math.max(0.6, Math.min(2.6, (vw * 0.92) / art.w, ((vh - 80) * 0.92) / art.h));
      pano.add(
        this.add
          .image(
            vw / 2 - (art.x + art.w / 2 - src.width / 2) * scale,
            vh / 2 - (art.y + art.h / 2 - src.height / 2) * scale,
            this.imageKey,
          )
          .setScale(scale),
      );
      // 가장자리를 배경색으로 부드럽게 덮어 그림 경계를 숨김
      const vcv = document.createElement('canvas');
      vcv.width = 256;
      vcv.height = 256;
      const vctx = vcv.getContext('2d');
      if (vctx) {
        const rgb = `${(art.bg >> 16) & 255},${(art.bg >> 8) & 255},${art.bg & 255}`;
        const grad = vctx.createRadialGradient(128, 128, 70, 128, 128, 182);
        grad.addColorStop(0, `rgba(${rgb},0)`);
        grad.addColorStop(1, `rgba(${rgb},1)`);
        vctx.fillStyle = grad;
        vctx.fillRect(0, 0, 256, 256);
        const vk = `vig_${Date.now()}`;
        this.textures.addCanvas(vk, vcv);
        this.textures.get(vk).setFilter(Phaser.Textures.FilterMode.LINEAR);
        pano.add(this.add.image(vw / 2, vh / 2, vk).setDisplaySize(vw * 1.15, vh * 1.15));
      }
    } else {
      pano.add(this.add.rectangle(vw / 2, vh / 2, vw, vh, 0x15151d));
      pano.add(this.add.text(vw / 2, vh / 2, t('territory.noImage'), TEXT_STYLE).setOrigin(0.5));
    }
    const toggle = this.add
      .text(vw - 12, 12, t('territory.viewPano'), {
        ...TEXT_STYLE,
        fontSize: '14px',
        backgroundColor: '#2e2548',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .setScrollFactor(0)
      .setDepth(10);
    // 오른쪽 위 버튼들: 건물 이동, 확대/축소
    const btnStyle = {
      ...TEXT_STYLE,
      fontSize: '14px',
      backgroundColor: '#2e2548',
      padding: { x: 8, y: 4 },
    };
    const hudBtn = (x: number, y: number, label: string, fn: () => void) => {
      const b = this.add
        .text(x, y, label, btnStyle)
        .setOrigin(1, 0)
        .setInteractive({ useHandCursor: true })
        .setScrollFactor(0)
        .setDepth(10);
      b.on('pointerdown', fn);
      return b;
    };
    const moveBtn = hudBtn(vw - 12, 44, '', () => {
      if (this.placing) {
        // 건물 놓기 취소
        this.placing = null;
        target = null;
        redrawMoveMarks();
        refreshHint();
        return;
      }
      this.moveMode = !this.moveMode;
      this.moveSelected = null;
      target = null;
      redrawMoveMarks();
      refreshHint();
    });
    const zoomIn = hudBtn(vw - 12, 78, '＋', () => zoomAt(vw / 2, vh / 2, 1.2));
    const zoomOut = hudBtn(vw - 12, 108, '－', () => zoomAt(vw / 2, vh / 2, 1 / 1.2));
    const hint = this.add
      .text(12, 12, '', {
        ...TEXT_STYLE,
        fontSize: '13px',
        strokeThickness: 3,
        color: '#cfc8e8',
      })
      .setScrollFactor(0)
      .setDepth(10);
    refreshHint = (): void => {
      moveBtn.setText(
        this.placing
          ? t('territory.placeCancel')
          : this.moveMode
            ? t('territory.moveOff')
            : t('territory.moveOn'),
      );
      moveBtn.setBackgroundColor(this.placing ? '#8f3a1f' : this.moveMode ? '#1f6f8f' : '#2e2548');
      // 튜토리얼 중에는 건물 이동을 막는다 (건물 놓기 취소는 가능)
      moveBtn.setVisible(!this.init_.tutorialActive || this.placing !== null);
      hint.setText(
        this.placing
          ? t('territory.placeHint', { name: t(`building.${this.placing}`) })
          : !this.moveMode
            ? t('territory.villageHint')
            : this.moveSelected === null
              ? t('territory.movePick')
              : t('territory.movePlace'),
      );
    };
    refreshHint();
    // 안내/오류 문구를 잠깐 띄운다
    const toast = this.add
      .text(vw / 2, TOP + 14, '', {
        ...TEXT_STYLE,
        fontSize: '15px',
        backgroundColor: '#3a1820',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(12)
      .setVisible(false);
    let toastTimer: Phaser.Time.TimerEvent | null = null;
    flash = (msg: string): void => {
      toast.setText(msg).setVisible(true);
      toastTimer?.remove();
      toastTimer = this.time.delayedCall(2600, () => toast.setVisible(false));
    };
    redrawMoveMarks();

    let panoOn = false;
    toggle.on('pointerdown', () => {
      panoOn = !panoOn;
      pano.setVisible(panoOn);
      world.setVisible(!panoOn);
      troopLayer.setVisible(!panoOn);
      for (const b of [moveBtn, zoomIn, zoomOut, hint]) b.setVisible(!panoOn);
      if (!panoOn) refreshHint(); // 이동 버튼 표시 여부를 다시 맞춘다
      toggle.setText(panoOn ? t('territory.viewVillage') : t('territory.viewPano'));
    });

    // 남은 시간 갱신 (1초마다)
    const tick = (): void => {
      const n = this.nowMs();
      let done = false;
      for (const tm of this.timers) {
        tm.text.setText(`${tm.prefix}${fmt((tm.finishAt - n) / 1000)}`);
        if (tm.finishAt <= n) done = true;
      }
      if (done && !this.doneSignaled) {
        this.doneSignaled = true;
        this.init_.onTimerDone?.();
      }
    };
    tick();
    this.time.addEvent({ delay: 1000, loop: true, callback: tick });
  }
}

/** 세로(모바일) 화면인지: 가로가 좁거나 세로가 더 긴 경우 */
export function isPortrait(parent: HTMLElement): boolean {
  const w = parent.clientWidth || window.innerWidth;
  const h = parent.clientHeight || window.innerHeight;
  return w < 700 || w / Math.max(1, h) < 1.1;
}

export function startTerritoryGame(parent: HTMLElement, init: TerritoryInit): Phaser.Game {
  let width = WIDTH;
  let height = HEIGHT;
  if (isPortrait(parent)) {
    // 세로 화면: 폭 600 만 보이게 하고 나머지는 드래그로 이동
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    width = 600;
    height = Math.min(1000, Math.max(480, Math.round((600 * h) / Math.max(1, w))));
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: width * ZOOM,
    height: height * ZOOM,
    backgroundColor: '#15151d',
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  // 화면에 맞춰 줄일 때 글자가 깨지지 않도록 부드럽게(도트 그림은 이미 확대 필터로 처리)
  game.canvas.style.imageRendering = 'auto';
  game.scene.add('Territory', TerritoryScene, true, init);
  return game;
}
