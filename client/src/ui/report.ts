import type { OfflineReport } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { describeEvent } from './eventText';
import { RES_COLORS, openModal } from './panels';

function fmtAway(sec: number): string {
  const d = Math.floor(sec / 86400);
  const hh = Math.floor((sec % 86400) / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}일 ${hh}시간`;
  if (hh > 0) return `${hh}시간 ${mm}분`;
  return `${mm}분`;
}

/** 접속 시 보여 주는 "자리를 비운 동안" 요약: 자원 변화 + 있었던 일 (반복되는 일은 묶어서 표시) */
export function openReportModal(report: OfflineReport): void {
  const counts: Record<string, number> = {};
  const detailed: string[] = [];
  for (const ev of report.events) {
    // 개별로 보여 줄 중요한 일
    const special =
      ev.key === 'raid' ||
      ev.key === 'guildBossDone' ||
      ev.key === 'pvpDefended' ||
      ev.key === 'levelUp' ||
      (ev.key === 'expeditionDone' && (ev.params as { event?: string }).event);
    if (special) detailed.push(describeEvent(ev));
    else counts[ev.key] = (counts[ev.key] ?? 0) + 1;
  }
  const summaryLines: string[] = [];
  const add = (key: string, i18nKey: string) => {
    if (counts[key]) summaryLines.push(t(i18nKey, { n: counts[key] }));
  };
  add('trainDone', 'report.train');
  add('craftDone', 'report.craft');
  add('buildingUpgraded', 'report.upgrade');
  add('researchDone', 'report.research');
  add('expeditionDone', 'report.exped');

  const deltas = Object.entries(report.resourceDelta).filter(([, v]) => v !== 0);
  const body = h(
    'div',
    { class: 'modal-body' },
    h('div', { class: 'muted' }, t('report.away', { t: fmtAway(report.awaySec) })),
    h('h3', {}, t('report.gained')),
    deltas.length
      ? h(
          'div',
          { class: 'row', style: 'justify-content:flex-start;flex-wrap:wrap' },
          ...deltas.map(([k, v]) =>
            h(
              'span',
              { style: `color:${v > 0 ? RES_COLORS[k] : '#ff7b7b'};margin-right:12px` },
              `${t(`resource.${k}`)} ${v > 0 ? '+' : ''}${v}`,
            ),
          ),
        )
      : h('div', { class: 'muted' }, t('report.none')),
    h('h3', { style: 'margin-top:12px' }, t('report.happened')),
    h('ul', {}, ...[...detailed, ...summaryLines].map((line) => h('li', {}, line))),
    h('div', { class: 'row', style: 'margin-top:12px' }),
  );
  const close = openModal(t('report.heading'), body, () => undefined);
  body.lastElementChild?.append(
    h('button', { class: 'btn primary', onclick: close }, t('report.ok')),
  );
}
