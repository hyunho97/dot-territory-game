import { api } from '../api/client';
import type { DungeonRun, DungeonState } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { RES_COLORS, errMsg, openModal } from './panels';
import type { PanelCtx } from './panels';

const unitName = (id: string): string => t(`unit.${id}`);

export function openDungeonPanel(ctx: PanelCtx): void {
  const serverId = ctx.getChar().serverId;
  const body = h('div', { class: 'modal-body' });
  const err = h('div', { class: 'error' });
  let state: DungeonState | null = null;
  let lastRun: DungeonRun | null = null;
  const sel: Record<string, number> = {};
  let stopAt = 1;

  const resultView = (run: DungeonRun): HTMLElement => {
    const rewards = Object.entries(run.resources)
      .filter(([, v]) => v > 0)
      .map(([k, v]) =>
        h(
          'span',
          { style: `color:${RES_COLORS[k]};margin-right:10px` },
          `${t(`resource.${k}`)} +${v}`,
        ),
      );
    const extra: string[] = [];
    if (run.speedupMin > 0) extra.push(t('quest.speedup', { n: run.speedupMin }));
    for (const it of run.equipment)
      extra.push(
        t('quest.gotEquip', {
          name: `${t(`equip.grade.${it.grade}`)} ${t(`equip.type.${it.type}`)} (+${it.power}%)`,
        }),
      );
    return h(
      'div',
      { class: 'panel', style: 'margin-top:10px' },
      h(
        'h3',
        { style: 'margin:0 0 6px' },
        t('dungeon.resultTitle', { n: run.cleared, reason: t(`dungeon.reason.${run.reason}`) }),
      ),
      run.newBest
        ? h('div', { class: 'pro' }, t('dungeon.newBest', { n: run.bestFloor }))
        : h('div'),
      h('div', { class: 'muted' }, t('dungeon.floorLog')),
      ...run.floors.map((f) =>
        h(
          'div',
          { class: 'build-row' },
          h(
            'span',
            {},
            `${t('dungeon.floor', { n: f.floor })}  ${t('battle.enemyCP')} ${f.enemyCP}`,
          ),
          h(
            'span',
            { class: f.winner === 'A' ? 'pro' : 'con' },
            `${f.winner === 'A' ? t('battle.result.win') : t('battle.result.lose')} · ${t('dungeon.lost', { n: f.lost })}`,
          ),
        ),
      ),
      h('div', { style: 'margin-top:6px' }, `${t('battle.reward')}: `, ...rewards),
      extra.length ? h('div', { class: 'pro' }, extra.join(' · ')) : h('div'),
      run.equipmentSkipped ? h('div', { class: 'con' }, t('dungeon.invFull')) : h('div'),
    );
  };

  const render = () => {
    if (!state) return;
    const st = state;
    const ch = ctx.getChar();
    if (st.locked) {
      body.replaceChildren(h('div', { class: 'error' }, t('dungeon.locked', { n: st.minLevel })));
      return;
    }
    stopAt = Math.max(1, Math.min(st.maxFloors, stopAt));
    const startBtn = h('button', { class: 'btn primary' }, t('dungeon.enter'));
    const total = h('div', { class: 'muted' });
    const risk = h('div', {});
    let myCP = 0;
    const showRisk = () => {
      const f = Math.max(1, Math.min(st.maxFloors, Math.floor(stopAt) || 1));
      const enemy = st.baseCP * Math.pow(st.cpGrowth, f - 1);
      const ratio = myCP > 0 ? enemy / myCP : Infinity;
      const level = ratio <= 0.1 ? 'safe' : ratio <= 0.2 ? 'costly' : 'danger';
      risk.className = level === 'safe' ? 'pro' : level === 'costly' ? 'muted' : 'con';
      risk.textContent = t(`dungeon.risk.${level}`, { f, cp: Math.round(enemy) });
    };
    const calc = () => {
      let n = 0;
      let cp = 0;
      for (const u of ch.units) {
        const v = Math.max(0, Math.min(u.count, Math.floor(sel[u.unitId] || 0)));
        sel[u.unitId] = v;
        n += v;
        cp += v * (ch.unitCP[u.unitId] ?? 0);
      }
      total.textContent = `${t('battle.selected', { n, max: ch.idleTroops })} · ${t('battle.myCP')} ${Math.round(cp)}`;
      myCP = cp;
      showRisk();
      (startBtn as HTMLButtonElement).disabled = n < 1 || n > ch.idleTroops || st.entriesLeft < 1;
    };
    if (Object.keys(sel).length === 0) {
      let left = ch.idleTroops;
      for (const u of ch.units) {
        sel[u.unitId] = Math.min(u.count, left);
        left -= sel[u.unitId];
      }
      stopAt = Math.min(st.maxFloors, st.bestFloor + 3);
    }
    const rows = ch.units.map((u) => {
      const input = h('input', {
        class: 'input',
        type: 'number',
        min: 0,
        max: u.count,
        value: sel[u.unitId] ?? 0,
      }) as HTMLInputElement;
      input.addEventListener('input', () => {
        sel[u.unitId] = Number(input.value);
        calc();
      });
      return h(
        'div',
        { class: 'build-row' },
        h(
          'span',
          {},
          `${unitName(u.unitId)} (${u.count}) · CP ${Math.round(ch.unitCP[u.unitId] ?? 0)}`,
        ),
        input,
      );
    });
    const stopInput = h('input', {
      class: 'input',
      type: 'number',
      min: 1,
      max: st.maxFloors,
      value: stopAt,
    }) as HTMLInputElement;
    stopInput.addEventListener('input', () => {
      stopAt = Number(stopInput.value);
      showRisk();
    });
    startBtn.addEventListener('click', async () => {
      err.textContent = '';
      (startBtn as HTMLButtonElement).disabled = true;
      try {
        lastRun = await api.dungeonRun(serverId, sel, Math.max(1, Math.floor(stopAt) || 1));
        state = lastRun.state;
        for (const k of Object.keys(sel)) delete sel[k]; // 손실 반영 후 다시 기본값 채움
        await ctx.refresh();
      } catch (e) {
        err.textContent = errMsg(e);
      }
      render();
    });

    body.replaceChildren(
      h(
        'div',
        { class: 'row', style: 'justify-content:flex-start;gap:16px;flex-wrap:wrap' },
        h('strong', {}, t('dungeon.best', { n: st.bestFloor, max: st.maxFloors })),
        h(
          'span',
          { class: st.entriesLeft > 0 ? 'pro' : 'con' },
          t('dungeon.entries', { n: st.entriesLeft, max: st.maxEntries }),
        ),
      ),
      h('div', { class: 'muted' }, t('dungeon.desc')),
      h('h3', { style: 'margin-top:10px' }, t('dungeon.next')),
      ...st.preview.map((p) =>
        h(
          'div',
          { class: 'build-row' },
          h(
            'span',
            {},
            `${t('dungeon.floor', { n: p.floor })}  ${unitName(p.enemyUnitId)}  ${t('battle.enemyCP')} ${p.enemyCP}`,
          ),
          h(
            'span',
            {},
            ...Object.entries(p.reward).map((e) =>
              h(
                'span',
                { style: `color:${RES_COLORS[e[0]]};margin-left:8px` },
                `${t(`resource.${e[0]}`)} ${e[1]}`,
              ),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'muted', style: 'margin-top:4px' },
        t('dungeon.milestone', {
          every: st.milestones.speedupEvery,
          min: st.milestones.speedupMinPerStep,
          equip: st.milestones.equipmentEvery,
        }),
      ),
      h('h3', { style: 'margin-top:10px' }, t('dungeon.troops')),
      ...rows,
      total,
      risk,
      h(
        'div',
        { class: 'row', style: 'justify-content:flex-start;gap:8px;margin-top:8px' },
        h('span', {}, t('dungeon.stopAt')),
        stopInput,
        startBtn,
      ),
      err,
      lastRun ? resultView(lastRun) : h('div'),
    );
    calc();
  };

  openModal(t('dungeon.heading'), body, () => undefined, true);
  body.replaceChildren(h('div', { class: 'muted' }, t('common.loading')));
  api
    .dungeon(serverId)
    .then((s) => {
      state = s;
      render();
    })
    .catch((e) => body.replaceChildren(h('div', { class: 'error' }, errMsg(e))));
}
