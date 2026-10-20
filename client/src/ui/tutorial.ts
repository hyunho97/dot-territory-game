import type { QuestView } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { openModal } from './panels';

/** 하단 메뉴 버튼 키 (튜토리얼이 가리키는 대상) */
export type DockKey =
  | 'territory'
  | 'barracks'
  | 'smithy'
  | 'battle'
  | 'explore'
  | 'market'
  | 'dungeon'
  | 'guild'
  | 'research'
  | 'ranking'
  | 'quest'
  | 'admin';

export interface TutorialStep {
  id: string;
  index: number;
  total: number;
  /** 지금 눌러야 하는 하단 메뉴 버튼 */
  target: DockKey;
  /** 목표를 달성해 보상 수령만 남았는지 */
  ready: boolean;
}

/** 튜토리얼 퀘스트 순서대로 처음 "안 받은" 단계 → 해당 단계에서 눌러야 할 버튼. 모두 끝났으면 null */
const TARGETS: Record<string, DockKey> = {
  t_build_farm: 'territory',
  t_train: 'barracks',
  t_expedition: 'explore',
  t_pve: 'battle',
  t_level2: 'territory',
  t_upgrade: 'territory',
};

/** 튜토리얼 단계에서 영지 화면에 반짝이게 할 건물 */
export function highlightBuilding(step: TutorialStep | null): string | null {
  if (!step || step.ready) return null;
  if (step.id === 't_build_farm' || step.id === 't_upgrade') return 'farm';
  if (step.id === 't_level2') return 'town_hall';
  if (step.id === 't_train') return 'barracks';
  return null;
}

export function currentStep(tutorial: QuestView[] | null): TutorialStep | null {
  if (!tutorial) return null;
  const index = tutorial.findIndex((q) => !q.claimed);
  if (index < 0) return null;
  const q = tutorial[index];
  const ready = q.progress >= q.count;
  return {
    id: q.id,
    index,
    total: tutorial.length,
    target: ready ? 'quest' : (TARGETS[q.id] ?? 'quest'),
    ready,
  };
}

/** 화면 위쪽 안내 배너 */
export function guideEl(step: TutorialStep, onSkip?: () => void): HTMLElement {
  const key = step.ready ? 'tutorial.claim' : `tutorial.step.${step.id}`;
  return h(
    'div',
    { class: 'guide' },
    h(
      'span',
      { class: 'guide-badge' },
      t('tutorial.badge', { n: step.index + 1, max: step.total }),
    ),
    h(
      'div',
      { class: 'guide-text' },
      h('strong', {}, t(step.ready ? 'tutorial.claimTitle' : `tutorial.title.${step.id}`)),
      h('div', {}, t(key)),
    ),
    onSkip ? h('button', { class: 'btn small', onclick: onSkip }, t('tutorial.skipAdmin')) : '',
  );
}

/** 처음 접속 시 보여 주는 게임 흐름 소개 */
export function openIntro(onClose?: () => void): void {
  const body = h(
    'div',
    { class: 'modal-body' },
    h('p', {}, t('tutorial.introLead')),
    h(
      'ol',
      { class: 'intro-list' },
      ...(['res', 'build', 'troop', 'fight', 'grow'] as const).map((k) =>
        h('li', {}, t(`tutorial.intro.${k}`)),
      ),
    ),
    h('p', { class: 'pro' }, t('tutorial.introEnd')),
  );
  openModal(t('tutorial.introTitle'), body, () => onClose?.());
}

/** 튜토리얼을 모두 마쳤을 때 안내 (앞으로 할 수 있는 것들) */
export function openOutro(): void {
  const body = h(
    'div',
    { class: 'modal-body' },
    h('p', {}, t('tutorial.outroLead')),
    h(
      'ul',
      { class: 'intro-list' },
      ...(['smithy', 'dungeon', 'guild', 'research', 'daily'] as const).map((k) =>
        h('li', {}, t(`tutorial.outro.${k}`)),
      ),
    ),
  );
  openModal(t('tutorial.outroTitle'), body, () => undefined);
}
