import { assetUrl } from '../assetUrl';
import { api } from '../api/client';
import type { UnitData } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { costEl, errMsg, fmtDuration, openModal, once } from './panels';
import type { PanelCtx } from './panels';

/** 막사: 내 종족 유닛 목록(잠금/해금 표시), 수량 선택, 모집 큐 */
export function openBarracksPanel(ctx: PanelCtx): void {
  const body = h('div', { class: 'modal-body' });
  const err = h('div', { class: 'error' });
  let timer = 0;
  let close: () => void = () => {};
  let offset = ctx.getChar().serverNow - Date.now();
  const now = () => Date.now() + offset;
  const amounts = new Map<string, number>(); // 다시 그려도 입력한 수량 유지

  const thumb = (u: UnitData): HTMLElement => {
    const path = ctx.manifest[u.sprite];
    return h(
      'div',
      { class: 'thumb' },
      path
        ? h('img', { src: assetUrl(path), alt: t(`unit.${u.id}`) })
        : h('div', { class: 'placeholder-sprite' }, t(`unit.${u.id}`)),
    );
  };

  const render = () => {
    const ch = ctx.getChar();
    offset = ch.serverNow - Date.now();
    const mods = ctx.race.mods;
    const room = Math.max(0, ch.maxTroops - ch.totalTroops - ch.queuedTroops);
    const hasBarracks = ch.buildings.some(
      (b) => b.type === 'barracks' && (b.finishAt === null || b.finishAt <= now()),
    );
    const queueFull = ch.trainQueue.length >= ch.trainSlots;

    const sections: HTMLElement[] = [
      h(
        'div',
        { class: 'muted' },
        `${t('barracks.troops', { n: ch.totalTroops, max: ch.maxTroops, q: ch.queuedTroops })} · ${t(
          'barracks.slots',
          { n: ch.trainQueue.length, max: ch.trainSlots },
        )}`,
      ),
      h('h3', {}, t('barracks.queue')),
    ];
    const queue = h('div', { class: 'build-row-list' });
    if (ch.trainQueue.length === 0)
      queue.append(h('div', { class: 'muted' }, t('barracks.queueNone')));
    for (const q of ch.trainQueue) {
      queue.append(
        h(
          'div',
          { class: 'build-row' },
          h('strong', {}, t('barracks.queueItem', { unit: t(`unit.${q.unitId}`), n: q.amount })),
          h(
            'span',
            { class: 'cd', 'data-finish': q.finishAt },
            t('barracks.ready', { t: fmtDuration((q.finishAt - now()) / 1000) }),
          ),
        ),
      );
    }
    sections.push(queue);
    if (!hasBarracks) sections.push(h('div', { class: 'error' }, t('barracks.noBarracks')));

    const myUnits = ctx.units
      .filter((u) => u.race === ch.race)
      .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
    for (const u of myUnits) {
      const locked = u.requiredTerritoryLevel > ch.territoryLevel;
      const perUnitSec = Math.ceil(u.trainTimeSec / (mods.trainSpeed * (1 + ch.trainBonus)));
      // 지금 모집할 수 있는 최대 수: 병력 여유 / 자원으로 살 수 있는 수 중 작은 쪽
      const byRes = Object.entries(u.cost).reduce(
        (m, [k, v]) =>
          Math.min(
            m,
            Math.floor((ch.resources[k] ?? 0) / Math.max(1, Math.ceil(v * mods.costRate))),
          ),
        Infinity,
      );
      const maxN = Math.max(0, Math.min(room, byRes));
      const input = h('input', {
        class: 'input',
        type: 'number',
        min: 1,
        max: maxN || room,
        value: Math.min(amounts.get(u.id) ?? 1, Math.max(1, maxN)),
      });
      const maxHint = h(
        'div',
        { class: maxN > 0 ? 'pro' : 'con' },
        maxN > 0
          ? t('barracks.maxHint', { n: maxN, room, res: byRes })
          : room < 1
            ? t('barracks.maxFull')
            : t('barracks.maxNoRes'),
      );
      const maxBtn = h(
        'button',
        {
          class: 'btn small',
          onclick: () => {
            input.value = String(Math.max(1, maxN));
            upd();
          },
        },
        t('barracks.max'),
      );
      (maxBtn as HTMLButtonElement).disabled = maxN < 1;
      const total = h('div', { class: 'muted' });
      const upd = () => {
        const n = Math.max(0, Math.floor(Number(input.value) || 0));
        amounts.set(u.id, n || 1);
        total.textContent = `${t('barracks.total')} ${fmtDuration(perUnitSec * n)}`;
      };
      input.addEventListener('input', upd);
      upd();

      const btn = h('button', { class: 'btn primary' }, t('barracks.recruit'));
      (btn as HTMLButtonElement).disabled = locked || !hasBarracks || queueFull || room < 1;
      btn.addEventListener('click', async () => {
        err.textContent = '';
        (btn as HTMLButtonElement).disabled = true;
        try {
          await api.train(ch.serverId, u.id, Math.floor(Number(input.value)));
          await ctx.refresh();
        } catch (e) {
          err.textContent = errMsg(e);
        }
        render();
      });

      sections.push(
        h(
          'div',
          { class: `unit-card${locked ? ' locked' : ''}` },
          thumb(u),
          h(
            'div',
            { class: 'info' },
            h(
              'div',
              {},
              h('strong', {}, t(`unit.${u.id}`)),
              h(
                'span',
                { class: 'muted' },
                `  ${t('barracks.tier', { n: u.tier })} · ${t(`class.${u.class}`)}`,
              ),
            ),
            h(
              'div',
              { class: 'muted' },
              t('barracks.stats', {
                hp: u.baseStats.hp,
                atk: u.baseStats.attack,
                def: u.baseStats.defense,
              }),
            ),
            locked
              ? h('div', { class: 'con' }, t('barracks.locked', { n: u.requiredTerritoryLevel }))
              : h(
                  'div',
                  {},
                  costEl(u.cost, ch.resources, mods.costRate, ch.storageCap),
                  h(
                    'span',
                    { class: 'muted' },
                    ` ${t('barracks.time', { t: fmtDuration(perUnitSec) })}`,
                  ),
                ),
          ),
          locked
            ? h('div', { class: 'buy' })
            : h(
                'div',
                { class: 'buy' },
                h('div', { class: 'row', style: 'gap:6px' }, input, maxBtn),
                maxHint,
                total,
                btn,
              ),
        ),
      );
    }
    body.replaceChildren(...sections, err);
  };

  render();
  close = openModal(t('barracks.heading'), body, () => clearInterval(timer), true);
  const tick = once(() =>
    ctx
      .refresh()
      .then(render)
      .catch(() => close()),
  );
  timer = window.setInterval(() => {
    let finished = false;
    body.querySelectorAll<HTMLElement>('.cd').forEach((el) => {
      const left = (Number(el.dataset.finish) - now()) / 1000;
      el.textContent = t('barracks.ready', { t: fmtDuration(left) });
      if (left <= 0) finished = true;
    });
    if (finished) tick();
  }, 1000);
}
