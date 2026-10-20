import { LOCAL } from 'virtual:local-boot';
import { api } from '../api/client';
import type { RankRow, RankingState } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { errMsg, openModal } from './panels';
import type { PanelCtx } from './panels';

export function openRankingPanel(ctx: PanelCtx): void {
  const serverId = ctx.getChar().serverId;
  const body = h('div', { class: 'modal-body' });
  let type: 'cp' | 'level' = 'cp';

  const row = (r: RankRow): HTMLElement =>
    h(
      'div',
      { class: 'build-row', style: r.isMe ? 'border-color:var(--gold)' : '' },
      h(
        'span',
        {},
        h('strong', {}, `${r.rank}. ${r.name}`),
        h(
          'span',
          { class: 'muted' },
          `  ${t('ranking.owner', { name: r.owner })} · ${t(`race.${r.race}.name`)}`,
        ),
      ),
      h(
        'span',
        { class: r.isMe ? 'pro' : '' },
        type === 'cp'
          ? `${t('territory.cp')} ${r.cp}`
          : `${t('territory.level', { n: r.level })} · ${r.cp}`,
      ),
    );

  const load = async () => {
    body.replaceChildren(h('div', { class: 'muted' }, t('common.loading')));
    let st: RankingState;
    try {
      st = await api.ranking(serverId, type);
    } catch (e) {
      body.replaceChildren(h('div', { class: 'error' }, errMsg(e)));
      return;
    }
    const tab = (k: 'cp' | 'level', label: string) =>
      h(
        'button',
        {
          class: `btn${type === k ? ' primary' : ''}`,
          onclick: () => {
            type = k;
            void load();
          },
        },
        label,
      );
    body.replaceChildren(
      LOCAL ? h('div', { class: 'muted' }, t('npc.note')) : '',
      h(
        'div',
        { class: 'row', style: 'justify-content:flex-start;margin-bottom:8px' },
        tab('cp', t('ranking.cp')),
        tab('level', t('ranking.level')),
      ),
      st.me
        ? h(
            'div',
            { class: 'pro', style: 'margin-bottom:8px' },
            t('ranking.me', { n: st.me.rank, total: st.total }),
          )
        : h('div'),
      ...(st.top.length ? st.top.map(row) : [h('div', { class: 'muted' }, t('ranking.none'))]),
    );
  };

  openModal(t('ranking.heading'), body, () => undefined);
  void load();
}
