import { api } from '../api/client';
import type { ResearchState } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { iconEl } from './icons';
import { costEl, errMsg, fmtDuration, once, openModal, speedupRow } from './panels';
import type { PanelCtx } from './panels';

export function openResearchPanel(ctx: PanelCtx): void {
  const serverId = ctx.getChar().serverId;
  const body = h('div', { class: 'modal-body' });
  const err = h('div', { class: 'error' });
  let state: ResearchState | null = null;
  let offset = 0;
  let timer = 0;
  const now = () => Date.now() + offset;
  const pct = (v: number): string => `+${Math.round(v * 100)}%`;

  const apply = (s: ResearchState) => {
    state = s;
    offset = s.serverNow - Date.now();
  };

  const render = () => {
    if (!state) return;
    const st = state;
    const ch = ctx.getChar();
    if (!st.hasLab) {
      body.replaceChildren(h('div', { class: 'error' }, t('research.noLab')));
      return;
    }
    const items: HTMLElement[] = [];
    if (st.job) {
      items.push(
        h(
          'div',
          { class: 'build-row', style: 'border-color:var(--gold)' },
          h(
            'strong',
            {},
            t('research.busy', { tech: t(`research.tech.${st.job.techId}`), n: st.job.toLevel }),
          ),
          h(
            'span',
            { class: 'cd', 'data-finish': st.job.finishAt },
            t('buildPanel.remaining', { t: fmtDuration((st.job.finishAt - now()) / 1000) }),
          ),
          speedupRow(ctx, 'research', undefined, () => void load().then(() => ctx.refresh())),
        ),
      );
    }
    for (const tech of st.techs) {
      const btn = h('button', { class: 'btn primary' }, t('research.start'));
      (btn as HTMLButtonElement).disabled = !!st.job || tech.locked || !tech.next;
      btn.addEventListener('click', async () => {
        err.textContent = '';
        (btn as HTMLButtonElement).disabled = true;
        try {
          apply(await api.startResearch(serverId, tech.id));
          await ctx.refresh();
        } catch (e) {
          err.textContent = errMsg(e);
        }
        render();
      });
      items.push(
        h(
          'div',
          { class: `build-card${tech.locked ? ' locked' : ''}` },
          h(
            'div',
            { class: 'build-main' },
            h(
              'div',
              {},
              iconEl(
                `icons/research_${tech.id === 'logistics' ? 'supply' : tech.id}`,
                24,
                ctx.manifest,
              ) ?? '',
              h('strong', {}, ` ${t(`research.tech.${tech.id}`)}`),
              h(
                'span',
                { class: 'muted' },
                `  ${t('research.level', { n: tech.level, max: tech.maxLevel })}`,
              ),
            ),
            h('div', { class: 'muted' }, t(`research.desc.${tech.id}`)),
            h(
              'div',
              { class: 'pro' },
              t('research.effect', {
                now: pct(tech.perLevel * tech.level),
                next: tech.next ? pct(tech.perLevel * (tech.level + 1)) : '-',
              }),
            ),
            tech.locked
              ? h('div', { class: 'con' }, t('research.locked', { n: tech.unlockLevel }))
              : tech.next
                ? h(
                    'div',
                    {},
                    `${t('buildPanel.cost')}: `,
                    costEl(tech.next.cost, ch.resources, 1, ch.storageCap),
                    h(
                      'span',
                      { class: 'muted' },
                      `  ${t('research.time')} ${fmtDuration(tech.next.timeSec)}`,
                    ),
                  )
                : null,
          ),
          tech.next ? btn : h('span', { class: 'badge' }, t('research.maxed')),
        ),
      );
    }
    body.replaceChildren(...items, err);
  };

  openModal(t('research.heading'), body, () => clearInterval(timer), true);
  const load = () =>
    api
      .research(serverId)
      .then((s) => {
        apply(s);
        render();
      })
      .catch((e) => {
        err.textContent = errMsg(e);
        body.replaceChildren(err);
      });
  void load();
  const tick = once(() => load().then(() => ctx.refresh()));
  timer = window.setInterval(() => {
    let finished = false;
    body.querySelectorAll<HTMLElement>('.cd').forEach((el) => {
      const left = (Number(el.dataset.finish) - now()) / 1000;
      el.textContent = t('buildPanel.remaining', { t: fmtDuration(left) });
      if (left <= 0) finished = true;
    });
    if (finished) tick();
  }, 1000);
}
