import { assetUrl } from '../assetUrl';
import { h } from './dom';

/**
 * 건물 레벨 -> 이미지 단계(1부터). tiers 는 단계별 레벨 하한 목록 (예: [1, 4, 7]).
 * 매니페스트에 해당 종족/건물/단계 이미지가 없으면 null (플레이스홀더 사용).
 */
export function buildingSpriteKey(
  manifest: Record<string, string>,
  tiers: number[],
  race: string,
  type: string,
  level: number,
): string | null {
  let tier = 1;
  tiers.forEach((min, i) => {
    if (level >= min) tier = i + 1;
  });
  for (let t = tier; t >= 1; t--) {
    const key = `buildings/${race}/${type}_${t}`;
    if (manifest[key]) return key; // 더 높은 단계 이미지가 없으면 낮은 단계로 대체
  }
  return null;
}

/** 건물 썸네일: 이미지가 있으면 도트 이미지, 없으면 건물 고유색 사각형 */
export function buildingThumb(
  manifest: Record<string, string>,
  tiers: number[],
  race: string,
  type: string,
  level: number,
  color: string,
  size = 48,
): HTMLElement {
  const key = buildingSpriteKey(manifest, tiers, race, type, level);
  if (key)
    return h('img', {
      class: 'bld-thumb',
      src: assetUrl(manifest[key]),
      alt: type,
      width: size,
      height: size,
    });
  return h('span', { class: 'swatch', style: `background:${color}` });
}
