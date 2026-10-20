import { assetUrl } from '../assetUrl';
import { getManifestSync } from '../api/client';
import { h } from './dom';

/** 에셋 매니페스트에 있으면 도트 아이콘 <img>, 없으면 null (호출한 쪽이 기존 표시로 대체) */
export function iconEl(
  key: string,
  size = 18,
  manifest: Record<string, string> = getManifestSync(),
): HTMLElement | null {
  const path = manifest[key];
  if (!path) return null;
  return h('img', {
    class: 'icon',
    src: assetUrl(path),
    alt: '',
    width: size,
    height: size,
    style: `width:${size}px;height:${size}px;image-rendering:pixelated;vertical-align:middle`,
  });
}
