import { assetUrl } from '../assetUrl';
import Phaser from 'phaser';
import type { BuildingData, CharacterState, UnitData } from '../api/client';
import { t } from '../i18n';
import { buildingSpriteKey } from '../ui/buildingSprite';
import { SLOT_POS, slotOf } from './layout';

// 세계(건물이 놓이는 좌표계) 크기. 화면 크기는 가로/세로 모드에 따라 다르다.
const WIDTH = 960;
const HEIGHT = 600;
const MAX_IMAGE_LEVEL = 10;
const SPRITE = 84; // 일반 건물 표시 크기
const HALL = 128; // 영주관 표시 크기

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
    const vw = this.scale.width; // 화면(뷰) 크기
    const vh = this.scale.height;
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
      const dx = ptr.x - last.x;
      const dy = ptr.y - last.y;
      if (!dragged && Math.hypot(ptr.x - ptr.downX, ptr.y - ptr.downY) < 10) return;
      dragged = true;
      cam.scrollX -= dx;
      cam.scrollY -= dy;
      last = { x: ptr.x, y: ptr.y };
      clampCam();
    });

    // ── 바닥: 잔디 + 영주관 앞 길 ──
    if (has('tiles/grass')) {
      this.add
        .tileSprite(WIDTH / 2, HEIGHT / 2, WIDTH * 3, HEIGHT * 3, 'tiles/grass')
        .setTint(0xb8c8a8);
    } else {
      this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH * 3, HEIGHT * 3, 0x2c4a2a);
    }
    if (has('tiles/path')) {
      const plaza = this.add.tileSprite(480, 305, 380, 230, 'tiles/path').setAlpha(0.55);
      const maskG = this.make.graphics({ x: 0, y: 0 }, false);
      maskG.fillStyle(0xffffff);
      maskG.fillEllipse(480, 305, 380, 230);
      plaza.setMask(maskG.createGeometryMask());
    }
    const shade = this.add.graphics();
    shade.fillStyle(0x000000, 0.18);
    shade.fillRect(-WIDTH, -HEIGHT, WIDTH * 3, HEIGHT * 3);
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
      layer.add(this.add.ellipse(x, y + size * 0.18, size * 0.7, size * 0.18, 0x000000, 0.3));
      layer.add(img);

      const constructing = !!opts.b && opts.b.finishAt !== null && opts.b.finishAt > this.nowMs();
      const upgrading =
        !!opts.b && opts.b.upgradeFinishAt !== null && opts.b.upgradeFinishAt > this.nowMs();
      const smallText = { ...TEXT_STYLE, fontSize: '12px', strokeThickness: 3 };
      if (opts.ghost) {
        img.setAlpha(0.35);
        const plus = this.add
          .text(x, y - size * 0.25, '+', { ...TEXT_STYLE, fontSize: '30px' })
          .setOrigin(0.5);
        const label = this.add
          .text(x, y + size * 0.26, t(`building.${type}`), smallText)
          .setOrigin(0.5)
          .setAlpha(0.8);
        layer.add([plus, label]);
        this.tweens.add({ targets: plus, alpha: 0.35, yoyo: true, repeat: -1, duration: 900 });
        hits.push(plus);
      } else {
        if (constructing) img.setAlpha(0.55);
        const lvText = type === 'town_hall' ? level : (opts.b?.level ?? level);
        layer.add(
          this.add
            .text(x, y + size * 0.26, `${t(`building.${type}`)} Lv.${lvText}`, smallText)
            .setOrigin(0.5),
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
          layer.add(tx);
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
    pano.add(this.add.rectangle(vw / 2, vh / 2, vw, vh, 0x15151d));
    if (has(this.imageKey)) {
      const side = Math.min(vw, vh);
      pano.add(this.add.image(vw / 2, vh / 2, this.imageKey).setDisplaySize(side, side));
    } else {
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
    width,
    height,
    backgroundColor: '#15151d',
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add('Territory', TerritoryScene, true, init);
  return game;
}
