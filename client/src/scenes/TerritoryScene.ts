import Phaser from 'phaser';
import type { BuildingData, CharacterState, UnitData } from '../api/client';
import { t } from '../i18n';
import { buildingSpriteKey } from '../ui/buildingSprite';

const WIDTH = 960;
const HEIGHT = 600;
const MAX_IMAGE_LEVEL = 10;

export interface TerritoryInit {
  character: CharacterState;
  buildingData: BuildingData[];
  units: UnitData[];
  manifest: Record<string, string>;
  spriteTiers: number[];
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

/** 영지 메인 화면. 중앙에 영지 전경 이미지, 좌하단에 병력, 우측에 건물 목록(플레이스홀더). */
export class TerritoryScene extends Phaser.Scene {
  private init_!: TerritoryInit;
  private imageKey = '';

  constructor() {
    super('Territory');
  }

  init(data: TerritoryInit): void {
    this.init_ = data;
  }

  preload(): void {
    const { character, manifest, units, spriteTiers } = this.init_;
    this.imageKey = territoryImageKey(character.race, character.territoryLevel);
    // 현재 영지 이미지와 보유 유닛 스프라이트만 로드 (50장 전체를 올리지 않음)
    const needed = new Set<string>([this.imageKey]);
    for (const s of character.units) {
      const def = units.find((u) => u.id === s.unitId);
      if (def) needed.add(def.sprite);
    }
    for (const b of character.buildings) {
      const lv = b.type === 'town_hall' ? character.territoryLevel : b.level;
      const key = buildingSpriteKey(manifest, spriteTiers, character.race, b.type, lv);
      if (key) needed.add(key);
    }
    for (const id of needed) {
      if (manifest[id]) this.load.image(id, `/${manifest[id]}`);
    }
  }

  create(): void {
    const { character, buildingData, units } = this.init_;
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x15151d);

    if (this.textures.exists(this.imageKey)) {
      this.add.image(WIDTH / 2, HEIGHT / 2, this.imageKey).setDisplaySize(HEIGHT, HEIGHT);
    } else {
      this.add.text(WIDTH / 2, HEIGHT / 2, t('territory.noImage'), TEXT_STYLE).setOrigin(0.5);
    }

    // 우측: 보유 건물 (종류별 1칸, 최고 레벨/수량 표시). 영주관은 영지 레벨 기준 이미지 단계.
    this.add.text(WIDTH - 236, 16, t('territory.buildings'), TEXT_STYLE);
    const groups = new Map<string, { count: number; level: number }>();
    for (const b of character.buildings) {
      const g = groups.get(b.type) ?? { count: 0, level: 0 };
      g.count++;
      g.level = Math.max(g.level, b.type === 'town_hall' ? character.territoryLevel : b.level);
      groups.set(b.type, g);
    }
    let idx = 0;
    for (const [type, g] of groups) {
      const cellX = WIDTH - 236 + (idx % 2) * 116;
      const cellY = 48 + Math.floor(idx / 2) * 100;
      const key = buildingSpriteKey(
        this.init_.manifest,
        this.init_.spriteTiers,
        character.race,
        type,
        g.level,
      );
      if (key && this.textures.exists(key)) {
        this.add.image(cellX + 50, cellY + 28, key).setDisplaySize(56, 56);
      } else {
        const color = buildingData.find((d) => d.id === type)?.color ?? '#888888';
        this.add
          .rectangle(
            cellX + 50,
            cellY + 32,
            40,
            40,
            Phaser.Display.Color.HexStringToColor(color).color,
          )
          .setStrokeStyle(2, 0x000000);
      }
      const label = `${t(`building.${type}`)}\nLv.${g.level}${g.count > 1 ? ` ×${g.count}` : ''}`;
      this.add
        .text(cellX + 50, cellY + 60, label, {
          ...TEXT_STYLE,
          fontSize: '13px',
          strokeThickness: 3,
          align: 'center',
        })
        .setOrigin(0.5, 0);
      idx++;
    }

    // 좌하단: 병력
    let i = 0;
    for (const s of character.units) {
      const def = units.find((u) => u.id === s.unitId);
      const x = 56 + i * 96;
      const uy = HEIGHT - 70;
      if (def && this.textures.exists(def.sprite)) {
        this.add.image(x, uy, def.sprite).setDisplaySize(72, 72);
      } else {
        this.add.rectangle(x, uy, 40, 56, 0x888888).setStrokeStyle(3, 0x000000);
      }
      this.add.text(x, uy + 46, `x${s.count}`, TEXT_STYLE).setOrigin(0.5);
      i++;
    }
  }
}

export function startTerritoryGame(parent: HTMLElement, init: TerritoryInit): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: '#15151d',
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add('Territory', TerritoryScene, true, init);
  return game;
}
