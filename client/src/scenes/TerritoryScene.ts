import { assetUrl } from '../assetUrl';
import Phaser from 'phaser';
import type { BuildingData, CharacterState, UnitData } from '../api/client';
import { t } from '../i18n';
import { buildingSpriteKey } from '../ui/buildingSprite';
import { RINGS, SLOT_POS, slotOf } from './layout';

// 세계(건물이 놓이는 좌표계) 크기. 화면 크기는 가로/세로 모드에 따라 다르다.
const WIDTH = 960;
const HEIGHT = 600;
const ZOOM = 2; // 실제 캔버스 해상도 배율
const MAX_IMAGE_LEVEL = 10;
const SPRITE = 96; // 일반 건물 표시 크기
const HALL = 150; // 영주관 표시 크기

export interface TerritoryInit {
  character: CharacterState;
  buildingData: BuildingData[];
  units: UnitData[];
  manifest: Record<string, string>;
  spriteTiers: number[];
  /** 건물 이미지를 클릭했을 때 (건설/업그레이드 창 열기) */
  onBuildingClick?: (type: string) => void;
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
const GROUND: Record<string, { light: string; dark: string; path: string; dots: string[] }> = {
  human: {
    light: '#6f9a4a',
    dark: '#4f7a38',
    path: '#a58a5c',
    dots: ['#f2e27a', '#ffffff', '#e87a8a'],
  },
  elf: {
    light: '#5a9a5e',
    dark: '#3a7448',
    path: '#8d9a6a',
    dots: ['#b9f2c8', '#fff2a8', '#c8a8f2'],
  },
  dwarf: {
    light: '#7d7468',
    dark: '#5a5248',
    path: '#9c8468',
    dots: ['#c8b89a', '#8a8070', '#d89a4a'],
  },
  undead: {
    light: '#555a66',
    dark: '#383c4a',
    path: '#6e6a7e',
    dots: ['#7ae8e8', '#9aa0b4', '#b8a8d8'],
  },
  orc: {
    light: '#7e8a48',
    dark: '#5c6a34',
    path: '#9a7a4e',
    dots: ['#d86a3a', '#c8b078', '#a8442a'],
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

/** 마을 바닥 그림(잔디 얼룩 + 풀/꽃 점 + 영주관에서 건물로 뻗는 흙길)을 캔버스로 직접 그린다 */
function drawGround(
  tex: Phaser.Textures.CanvasTexture,
  race: string,
  hall: [number, number],
): void {
  const g = GROUND[race] ?? GROUND.human;
  const ctx = tex.getContext();
  const rand = rng([...race].reduce((n, c) => n * 31 + c.charCodeAt(0), 7));
  ctx.fillStyle = g.dark;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // 큰 얼룩으로 단조로움 줄이기
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = rand() < 0.5 ? g.light : g.dark;
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.ellipse(rand() * WIDTH, rand() * HEIGHT, 40 + rand() * 90, 24 + rand() * 50, 0, 0, 7);
    ctx.fill();
  }
  // 흙길: 겹선으로 가장자리를 부드럽게
  const road = (x1: number, y1: number, x2: number, y2: number, w: number): void => {
    for (const [mul, a] of [
      [1.5, 0.12],
      [1.15, 0.25],
      [0.8, 0.55],
    ] as const) {
      ctx.strokeStyle = g.path;
      ctx.globalAlpha = a;
      ctx.lineWidth = w * mul;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(
        (x1 + x2) / 2 + (y2 - y1) * 0.08,
        (y1 + y2) / 2 - (x2 - x1) * 0.08,
        x2,
        y2,
      );
      ctx.stroke();
    }
  };
  // 건물이 놓인 안쪽·가운데 고리를 따라 도는 길 + 영주관 앞 남쪽 입구길
  for (const ring of RINGS.slice(0, 2)) {
    for (const [mul, a] of [
      [20, 0.12],
      [14, 0.25],
      [8, 0.5],
    ] as const) {
      ctx.strokeStyle = g.path;
      ctx.globalAlpha = a;
      ctx.lineWidth = mul;
      ctx.beginPath();
      ctx.ellipse(480, 305, ring.a, ring.b, 0, 0, 7);
      ctx.stroke();
    }
  }
  road(hall[0], hall[1], hall[0], HEIGHT + 20, 26);
  // 영주관 앞 광장
  for (const [mul, a] of [
    [1.0, 0.18],
    [0.82, 0.3],
    [0.64, 0.55],
  ] as const) {
    ctx.fillStyle = g.path;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.ellipse(hall[0], hall[1] - 10, 190 * mul, 105 * mul, 0, 0, 7);
    ctx.fill();
  }
  // 자잘한 풀/꽃/돌 점
  for (let i = 0; i < 450; i++) {
    const x = rand() * WIDTH;
    const y = rand() * HEIGHT;
    const k = rand();
    ctx.globalAlpha = 0.5;
    if (k < 0.62) {
      ctx.fillStyle = rand() < 0.5 ? g.light : 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y, 2, 4 + rand() * 3);
    } else if (k < 0.9) {
      ctx.fillStyle = g.light;
      ctx.fillRect(x, y, 4, 2);
    } else {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = g.dots[Math.floor(rand() * g.dots.length)];
      ctx.fillRect(x, y, 3, 3);
    }
  }
  // 가장자리 어둡게(비네팅)
  ctx.globalAlpha = 1;
  const vg = ctx.createRadialGradient(
    WIDTH / 2,
    HEIGHT / 2,
    HEIGHT * 0.35,
    WIDTH / 2,
    HEIGHT / 2,
    WIDTH * 0.62,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
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
 * 영지 메인 화면. 영주관을 중심으로 건물이 마을처럼 배치되고, 건물을 클릭하면 건설/업그레이드 창이 열린다.
 * "전경 보기" 버튼으로 영지 전경 일러스트를 크게 볼 수 있다.
 */
export class TerritoryScene extends Phaser.Scene {
  private init_!: TerritoryInit;
  private imageKey = '';
  private initWall = 0;
  private doneSignaled = false;
  private timers: { text: Phaser.GameObjects.Text; finishAt: number; prefix: string }[] = [];

  constructor() {
    super('Territory');
  }

  init(data: TerritoryInit): void {
    this.init_ = data;
    this.timers = [];
    this.doneSignaled = false;
    this.initWall = Date.now();
  }

  preload(): void {
    const { character, manifest, units, spriteTiers, buildingData } = this.init_;
    this.imageKey = territoryImageKey(character.race, character.territoryLevel);
    const needed = new Set<string>([
      this.imageKey,
      'tiles/grass',
      'tiles/path',
      'buildings/under_construction',
    ]);
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
    // 세계가 화면보다 크면(세로 모드) 드래그로 이동, 작으면 가운데에 맞춘다
    const cam = this.cameras.main;
    const clampCam = (): void => {
      const maxX = Math.max(0, WIDTH - vw);
      cam.scrollX = vw >= WIDTH ? (WIDTH - vw) / 2 : Math.min(maxX, Math.max(0, cam.scrollX));
      cam.scrollY =
        vh >= HEIGHT ? (HEIGHT - vh) / 2 : Math.min(HEIGHT - vh, Math.max(0, cam.scrollY));
    };
    cam.scrollX = (WIDTH - vw) / 2;
    cam.scrollY = (HEIGHT - vh) / 2;
    clampCam();
    let dragged = false;
    let last: { x: number; y: number } | null = null;
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      dragged = false;
      last = { x: ptr.x, y: ptr.y };
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!ptr.isDown || !last) return;
      const dx = (ptr.x - last.x) / ZOOM;
      const dy = (ptr.y - last.y) / ZOOM;
      if (!dragged && Math.hypot(ptr.x - ptr.downX, ptr.y - ptr.downY) < 10) return;
      dragged = true;
      cam.scrollX -= dx;
      cam.scrollY -= dy;
      last = { x: ptr.x, y: ptr.y };
      clampCam();
    });

    // ── 바닥: 종족별 색의 잔디 + 영주관에서 뻗는 흙길 ──
    const groundTex = this.textures.createCanvas(`ground_${Date.now()}`, WIDTH, HEIGHT);
    if (groundTex) {
      drawGround(groundTex, character.race, SLOT_POS[SLOT_POS.length - 1]);
      this.add.image(WIDTH / 2, HEIGHT / 2, groundTex);
    } else {
      this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH * 3, HEIGHT * 3, 0x2c4a2a);
    }
    const bars = this.add.graphics().setScrollFactor(0).setDepth(4);
    bars.fillStyle(0x000000, 0.22);
    bars.fillRect(0, 0, vw, 44); // 상단 여백
    bars.fillRect(0, vh - 70, vw, 70); // 하단 병력 띠

    // ── 건물 레이어 ──
    const layer = this.add.container(0, 0);

    const placeSprite = (
      type: string,
      index: number,
      level: number,
      opts: { ghost?: boolean; b?: CharacterState['buildings'][number] },
    ): void => {
      const slot = slotOf(type, index);
      if (slot === null) return;
      const [x, y] = SLOT_POS[slot];
      const size = type === 'town_hall' ? HALL : SPRITE;
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
      // 바닥 그림자
      layer.add(this.add.ellipse(x, y + size * 0.18, size * 0.86, size * 0.24, 0x000000, 0.14));
      layer.add(this.add.ellipse(x, y + size * 0.18, size * 0.64, size * 0.15, 0x000000, 0.28));
      layer.add(img);

      const constructing = !!opts.b && opts.b.finishAt !== null && opts.b.finishAt > this.nowMs();
      const upgrading =
        !!opts.b && opts.b.upgradeFinishAt !== null && opts.b.upgradeFinishAt > this.nowMs();
      const smallText = { ...TEXT_STYLE, fontSize: '13px', strokeThickness: 3 };
      // 글자 뒤에 둥근 이름표를 깔아 어떤 바닥 위에서도 읽히게
      const pill = (tx: Phaser.GameObjects.Text, accent = 0x000000): void => {
        const bg = this.add.graphics();
        bg.fillStyle(accent, 0.55);
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
      if (opts.ghost) {
        img.setAlpha(0.01); // 눌러서 건설할 자리: 흐릿한 건물 그림 대신 깔끔한 터 표시
        layer.add(
          this.add
            .ellipse(x, y + size * 0.1, size * 0.9, size * 0.34, 0xffffff, 0.14)
            .setStrokeStyle(2, 0xffffff, 0.55),
        );
        layer.add(
          this.add.circle(x, y - size * 0.1, 17, 0x1a1428, 0.75).setStrokeStyle(2, 0xe8b830),
        );
        const plus = this.add
          .text(x, y - size * 0.1, '+', { ...TEXT_STYLE, fontSize: '26px', strokeThickness: 0 })
          .setOrigin(0.5);
        const label = this.add
          .text(x, y + size * 0.26, t(`building.${type}`), smallText)
          .setOrigin(0.5);
        pill(label);
        layer.add(plus);
        this.tweens.add({ targets: plus, alpha: 0.5, yoyo: true, repeat: -1, duration: 900 });
        hits.push(plus);
      } else {
        if (constructing) img.setAlpha(0.55);
        const lvText = type === 'town_hall' ? level : (opts.b?.level ?? level);
        pill(
          this.add
            .text(x, y + size * 0.26, `${t(`building.${type}`)} Lv.${lvText}`, smallText)
            .setOrigin(0.5),
          0x1a1428,
        );
        if (constructing && has('buildings/under_construction')) {
          const uc = this.add
            .image(x, y - size * 0.3, 'buildings/under_construction')
            .setDisplaySize(40, 40);
          layer.add(uc);
          hits.push(uc);
        }
        const fin = constructing ? opts.b?.finishAt : upgrading ? opts.b?.upgradeFinishAt : null;
        if (fin) {
          const tx = this.add
            .text(x, y - size * 0.78, '', {
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
      for (const o of hits) {
        o.setInteractive({ useHandCursor: true });
        o.on('pointerup', () => {
          if (!dragged) this.init_.onBuildingClick?.(type);
        });
        o.on('pointerover', () => (img as Phaser.GameObjects.Image).setTint?.(0xffffcc));
        o.on('pointerout', () => (img as Phaser.GameObjects.Image).clearTint?.());
      }
      if (this.init_.highlightType === type) {
        const ring = this.add
          .ellipse(x, y + size * 0.18, size * 0.95, size * 0.3)
          .setStrokeStyle(3, 0xe8b830);
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

    // 소유 건물: 종류별로 id 순서대로 슬롯에 배정 (영주관은 영지 레벨 기준 이미지)
    const byType = new Map<string, CharacterState['buildings']>();
    for (const b of [...character.buildings].sort((a, c) => a.id - c.id)) {
      const list = byType.get(b.type) ?? [];
      list.push(b);
      byType.set(b.type, list);
    }
    // 깊이: y 가 큰(아래쪽) 건물이 앞에 그려지도록 슬롯 y 순으로 배치
    const jobs: { y: number; run: () => void }[] = [];
    for (const [type, list] of byType) {
      list.forEach((b, i) => {
        const slot = slotOf(type, i);
        if (slot === null) return;
        jobs.push({
          y: SLOT_POS[slot][1],
          run: () =>
            placeSprite(type, i, type === 'town_hall' ? character.territoryLevel : b.level, { b }),
        });
      });
    }
    for (const d of buildingData) {
      if (!d.buildable || d.unlockLevel > character.territoryLevel) continue;
      const count = byType.get(d.id)?.length ?? 0;
      if (count >= d.maxCount) continue;
      const slot = slotOf(d.id, count);
      if (slot === null) continue;
      jobs.push({ y: SLOT_POS[slot][1], run: () => placeSprite(d.id, count, 1, { ghost: true }) });
    }
    jobs.sort((a, c) => a.y - c.y).forEach((j) => j.run());

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
    let panoOn = false;
    toggle.on('pointerdown', () => {
      panoOn = !panoOn;
      pano.setVisible(panoOn);
      layer.setVisible(!panoOn);
      troopLayer.setVisible(!panoOn);
      toggle.setText(panoOn ? t('territory.viewVillage') : t('territory.viewPano'));
    });
    this.add
      .text(12, 12, t('territory.villageHint'), {
        ...TEXT_STYLE,
        fontSize: '13px',
        strokeThickness: 3,
        color: '#cfc8e8',
      })
      .setScrollFactor(0)
      .setDepth(10);

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
