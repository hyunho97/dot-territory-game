import { api } from '../api/client';
import type { MarketState } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { errMsg, openModal } from './panels';
import type { PanelCtx } from './panels';

const RES = ['food', 'wood', 'stone', 'iron', 'gold'] as const;

export function openMarketPanel(ctx: PanelCtx): void {
  const serverId = ctx.getChar().serverId;
  const body = h('div', { class: 'modal-body' });
  const err = h('div', { class: 'error' });
  const msg = h('div', { class: 'pro' });
  let state: MarketState | null = null;
  let from = 'wood';
  let to = 'iron';
  let amount = 100;

  const out = (st: MarketState): number =>
    Math.floor(((amount * st.values[from]) / st.values[to]) * (1 - st.fee));

  const render = () => {
    if (!state) return;
    const st = state;
    const ch = ctx.getChar();
    if (!st.hasMarket) {
      body.replaceChildren(h('div', { class: 'error' }, t('market.noMarket')));
      return;
    }
    const select = (value: string, onChange: (v: string) => void): HTMLElement => {
      const el = h(
        'select',
        { class: 'input' },
        ...RES.map((r) =>
          h(
            'option',
            { value: r, ...(r === value ? { selected: true } : {}) },
            `${t(`resource.${r}`)} (${Math.floor(ch.resources[r])})`,
          ),
        ),
      );
      el.addEventListener('change', () => onChange((el as HTMLSelectElement).value));
      return el;
    };
    const preview = h('div', { class: 'pro' });
    const input = h('input', { class: 'input', type: 'number', min: 1, value: amount });
    const updPreview = () => {
      amount = Math.max(0, Math.floor(Number(input.value) || 0));
      preview.textContent = t('market.preview', { n: Math.max(0, out(st)) });
    };
    input.addEventListener('input', updPreview);
    const all = h('button', { class: 'btn' }, t('market.maxAll'));
    all.addEventListener('click', () => {
      input.value = String(Math.floor(ch.resources[from]));
      updPreview();
    });
    const go = h('button', { class: 'btn primary' }, t('market.exchange'));
    go.addEventListener('click', async () => {
      err.textContent = '';
      msg.textContent = '';
      (go as HTMLButtonElement).disabled = true;
      try {
        const r = await api.exchange(serverId, from, to, amount);
        state = r.market;
        msg.textContent =
          t('market.done', {
            spent: `${t(`resource.${from}`)} ${r.result.spent}`,
            got: `${t(`resource.${to}`)} ${r.result.got}`,
          }) +
          (r.result.lostToCap > 0 ? ` ${t('market.lostToCap', { n: r.result.lostToCap })}` : '');
        await ctx.refresh();
      } catch (e) {
        err.textContent = errMsg(e);
      }
      render();
    });

    body.replaceChildren(
      h(
        'div',
        { class: 'muted' },
        `${t('market.level', { n: st.level })} · ${t('market.fee', { n: Math.round(st.fee * 100) })} · ${t('market.limit', { used: st.usedToday, max: st.dailyLimit })}`,
      ),
      h('label', { style: 'display:block;margin-top:10px' }, t('market.from')),
      select(from, (v) => {
        from = v;
        if (to === v) to = RES.find((r) => r !== v)!;
        render();
      }),
      h('label', { style: 'display:block;margin-top:8px' }, t('market.to')),
      select(to, (v) => {
        to = v;
        if (from === v) from = RES.find((r) => r !== v)!;
        render();
      }),
      h('label', { style: 'display:block;margin-top:8px' }, t('market.amount')),
      h('div', { class: 'row' }, input, all),
      preview,
      h('div', { style: 'height:8px' }),
      go,
      h(
        'div',
        { class: 'muted', style: 'margin-top:12px' },
        `${t('market.rates')}: ` +
          RES.map((r) => `${t(`resource.${r}`)} ${st.values[r]}`).join(' · '),
      ),
      msg,
      err,
    );
    updPreview();
  };

  openModal(t('market.heading'), body, () => undefined);
  void api
    .market(serverId)
    .then((s) => {
      state = s;
      render();
    })
    .catch((e) => {
      err.textContent = errMsg(e);
      body.replaceChildren(err);
    });
}
