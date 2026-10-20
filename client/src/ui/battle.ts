import { api } from '../api/client';
import type { BattleOutcome, PvpTarget, StageInfo } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { RES_COLORS, errMsg, fmtDuration, openModal } from './panels';
import type { PanelCtx } from './panels';
import { playBattle } from './battleScene';

const W = 720;
const H = 360;

/** 전투 상대(PvE 토벌 대상 또는 PvP 영주)를 같은 준비/연출/결과 흐름으로 다루기 위한 추상화 */
interface Opponent {
  title: string;
  enemyCP: number;
  armyText: string;
  start: (sel: Record<string, number>) => Promise<BattleOutcome>;
}

const fmtCP = (n: number): string => (Math.round(n * 10) / 10).toString();

/** 전투: 상대 선택 → 참전 병력 선택 → (서버 계산 후) 연출 → 결과 창 */
export function openBattlePanel(ctx: PanelCtx): void {
  const body = h('div', { class: 'modal-body' });
  const err = h('div', { class: 'error' });
  let cancelled = false;
  let stopAnim: () => void = () => undefined;
  const close = openModal(
    t('battle.heading'),
    body,
    () => {
      cancelled = true;
      stopAnim();
    },
    true,
  );
  const serverId = ctx.getChar().serverId;

  const unitName = (id: string) => t(`unit.${id}`);
  const armyText = (a: { unitId: string; count: number }[]) =>
    a.map((x) => `${unitName(x.unitId)} ×${x.count}`).join(', ');
  const rewardText = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([k, v]) => `${t(`resource.${k}`)} +${v}`)
      .join(' · ');

  let tab: 'pve' | 'pvp' = 'pve';
  const showList = () => (tab === 'pve' ? showStages() : showPvp());
  const tabs = (): HTMLElement =>
    h(
      'div',
      { class: 'row', style: 'justify-content:flex-start;margin-bottom:8px' },
      ...(['pve', 'pvp'] as const).map((k) =>
        h(
          'button',
          {
            class: `btn${tab === k ? ' primary' : ''}`,
            onclick: () => {
              tab = k;
              void showList();
            },
          },
          t(k === 'pve' ? 'pvp.tabPve' : 'pvp.tabPvp'),
        ),
      ),
    );

  const showPvp = async () => {
    body.replaceChildren(h('div', { class: 'muted' }, t('common.loading')));
    let info;
    try {
      info = await api.pvpTargets(serverId);
    } catch (e) {
      body.replaceChildren(tabs(), h('div', { class: 'error' }, errMsg(e)));
      return;
    }
    if (cancelled) return;
    const offset = info.serverNow - Date.now();
    const nowS = () => Date.now() + offset;
    const cooldownLeft = (info.cooldownUntil - nowS()) / 1000;
    const protectedLeft = (info.protectedUntil - nowS()) / 1000;
    const items: HTMLElement[] = [
      tabs(),
      h(
        'div',
        { class: 'muted' },
        t('pvp.rule', {
          min: Math.round(info.rangeMin * 100),
          max: Math.round(info.rangeMax * 100),
        }),
      ),
      h('div', {}, `${t('battle.myCP')} ${fmtCP(info.myCP)}`),
    ];
    if (protectedLeft > 0)
      items.push(
        h('div', { class: 'pro' }, t('pvp.protectedSelf', { t: fmtDuration(protectedLeft) })),
      );
    items.push(
      h(
        'div',
        { class: cooldownLeft > 0 ? 'con' : 'pro' },
        cooldownLeft > 0 ? t('pvp.cooldown', { t: fmtDuration(cooldownLeft) }) : t('pvp.ready'),
      ),
    );
    if (info.targets.length === 0)
      items.push(h('div', { class: 'muted', style: 'margin-top:8px' }, t('pvp.none')));
    for (const tg of info.targets as PvpTarget[]) {
      const btn = h('button', { class: 'btn primary' }, t('pvp.attack'));
      (btn as HTMLButtonElement).disabled = cooldownLeft > 0 || ctx.getChar().idleTroops < 1;
      btn.addEventListener('click', () =>
        showPrepare({
          title: t('pvp.target', { name: tg.territoryName }),
          enemyCP: tg.cp,
          armyText: `${t('pvp.owner', { name: tg.owner })} · ${t(`race.${tg.race}.name`)} · ${t('territory.level', { n: tg.level })}`,
          start: (sel) => api.pvpAttack(serverId, tg.id, sel),
        }),
      );
      items.push(
        h(
          'div',
          { class: 'build-card' },
          h(
            'div',
            { class: 'build-main' },
            h(
              'div',
              {},
              h('strong', {}, tg.territoryName),
              h('span', { class: 'muted' }, `  ${t('pvp.owner', { name: tg.owner })}`),
            ),
            h(
              'div',
              { class: 'muted' },
              `${t(`race.${tg.race}.name`)} · ${t('territory.level', { n: tg.level })} · ${t('battle.enemyCP')} ${fmtCP(tg.cp)}`,
            ),
          ),
          btn,
        ),
      );
    }
    body.replaceChildren(...items);
  };

  const showStages = async () => {
    body.replaceChildren(h('div', { class: 'muted' }, t('common.loading')));
    let stages: StageInfo[] = [];
    try {
      stages = await api.stages(serverId);
    } catch (e) {
      body.replaceChildren(h('div', { class: 'error' }, errMsg(e)));
      return;
    }
    if (cancelled) return;
    const ch = ctx.getChar();
    const items: HTMLElement[] = [
      tabs(),
      h(
        'div',
        { class: 'muted' },
        `${t('battle.myTroops', { n: ch.idleTroops })} · ${t('territory.cp')} ${ch.totalCP}`,
      ),
    ];
    for (const s of stages) {
      const btn = h('button', { class: 'btn primary' }, t('battle.select'));
      (btn as HTMLButtonElement).disabled = s.locked || ch.idleTroops < 1;
      btn.addEventListener('click', () =>
        showPrepare({
          title: t(`stage.${s.id}`),
          enemyCP: s.enemyCP,
          armyText: armyText(s.army),
          start: (sel) => api.battleStart(serverId, s.id, sel),
        }),
      );
      items.push(
        h(
          'div',
          { class: `build-card${s.locked ? ' locked' : ''}` },
          h(
            'div',
            { class: 'build-main' },
            h(
              'div',
              {},
              h('strong', {}, t(`stage.${s.id}`)),
              h('span', { class: 'muted' }, `  ${t('battle.enemyCP')} ${fmtCP(s.enemyCP)}`),
            ),
            h('div', { class: 'muted' }, armyText(s.army)),
            h('div', { class: 'pro' }, `${t('battle.reward')}: ${rewardText(s.reward)}`),
            h('div', { class: 'muted' }, t('battle.rewardLeft', { n: s.rewardLeft })),
            s.firstClearSpeedupMin > 0
              ? h(
                  'div',
                  { class: s.cleared ? 'muted' : 'pro' },
                  s.cleared
                    ? t('battle.firstClearDone')
                    : t('battle.firstClear', { n: s.firstClearSpeedupMin }),
                )
              : null,
            s.locked
              ? h('div', { class: 'con' }, t('battle.locked', { n: s.requiredLevel }))
              : null,
          ),
          btn,
        ),
      );
    }
    body.replaceChildren(...items);
  };

  const showPrepare = (op: Opponent) => {
    const ch = ctx.getChar();
    const sel: Record<string, number> = {};
    let left = ch.idleTroops;
    for (const u of ch.units) {
      sel[u.unitId] = Math.min(u.count, left);
      left -= sel[u.unitId];
    }
    const total = h('div', {});
    const verdict = h('div', {});
    const startBtn = h('button', { class: 'btn primary' }, t('battle.start'));
    const inputs = new Map<string, HTMLInputElement>();

    const calc = () => {
      let n = 0;
      let cp = 0;
      for (const u of ch.units) {
        const v = Math.max(0, Math.min(u.count, Math.floor(sel[u.unitId] || 0)));
        sel[u.unitId] = v;
        n += v;
        cp += v * (ch.unitCP[u.unitId] ?? 0);
      }
      total.textContent = `${t('battle.selected', { n, max: ch.idleTroops })} · ${t('battle.myCP')} ${fmtCP(cp)} vs ${t('battle.enemyCP')} ${fmtCP(op.enemyCP)}`;
      const diff = cp - op.enemyCP;
      verdict.className = diff > 0 ? 'pro' : diff < 0 ? 'con' : 'muted';
      verdict.textContent =
        n === 0
          ? ''
          : diff > 0
            ? t('battle.edgeWin')
            : diff < 0
              ? t('battle.edgeLose')
              : t('battle.edgeDraw');
      (startBtn as HTMLButtonElement).disabled = n < 1 || n > ch.idleTroops;
    };

    const rows = ch.units.map((u) => {
      const input = h('input', {
        class: 'input',
        type: 'number',
        min: 0,
        max: u.count,
        value: sel[u.unitId],
      });
      inputs.set(u.unitId, input);
      input.addEventListener('input', () => {
        sel[u.unitId] = Number(input.value);
        calc();
      });
      const all = h('button', { class: 'btn' }, t('battle.all'));
      all.addEventListener('click', () => {
        const others = ch.units.reduce(
          (s, x) => (x.unitId === u.unitId ? s : s + (sel[x.unitId] || 0)),
          0,
        );
        sel[u.unitId] = Math.max(0, Math.min(u.count, ch.idleTroops - others));
        input.value = String(sel[u.unitId]);
        calc();
      });
      return h(
        'div',
        { class: 'build-row' },
        h('span', {}, `${unitName(u.unitId)} (${u.count}) · CP ${fmtCP(ch.unitCP[u.unitId] ?? 0)}`),
        h('span', { class: 'row' }, input, all),
      );
    });

    startBtn.addEventListener('click', async () => {
      err.textContent = '';
      (startBtn as HTMLButtonElement).disabled = true;
      try {
        const out = await op.start(sel);
        await showAnimation(op, out);
      } catch (e) {
        err.textContent = errMsg(e);
        calc();
      }
    });

    body.replaceChildren(
      h('h3', {}, op.title),
      h('div', { class: 'muted' }, `${t('battle.enemy')}: ${op.armyText}`),
      h('h3', { style: 'margin-top:12px' }, t('battle.chooseTroops')),
      ...rows,
      total,
      verdict,
      err,
      h(
        'div',
        { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn', onclick: () => void showList() }, t('common.back')),
        startBtn,
      ),
    );
    calc();
  };

  const loadImages = async (ids: string[]): Promise<Map<string, HTMLImageElement | null>> => {
    const map = new Map<string, HTMLImageElement | null>();
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            const def = ctx.units.find((u) => u.id === id);
            const path = def ? ctx.manifest[def.sprite] : undefined;
            if (!path) {
              map.set(id, null);
              return resolve();
            }
            const img = new Image();
            img.onload = () => {
              map.set(id, img);
              resolve();
            };
            img.onerror = () => {
              map.set(id, null);
              resolve();
            };
            img.src = `/${path}`;
          }),
      ),
    );
    return map;
  };

  /** 결과가 확정된 뒤 재생하는 연출 (결과에 영향 없음) */
  const showAnimation = async (op: Opponent, out: BattleOutcome) => {
    const ids = [...new Set([...out.armyA, ...out.armyB].map((u) => u.unitId))];
    const images = await loadImages(ids);
    if (cancelled) return;
    const loadImg = (key: string): HTMLImageElement | null => {
      const path = ctx.manifest[key];
      if (!path) return null;
      const im = new Image();
      im.src = `/${path}`;
      return im;
    };
    const canvas = h('canvas', { width: W, height: H, class: 'battle-canvas' });
    const skip = h('button', { class: 'btn' }, t('battle.skip'));
    body.replaceChildren(
      h('h3', {}, op.title),
      canvas,
      h('div', { class: 'row', style: 'margin-top:8px' }, skip),
    );
    const player = playBattle(
      canvas,
      out,
      {
        images,
        classOf: (id) => ctx.units.find((u) => u.id === id)?.class,
        nameOf: unitName,
        bg: loadImg('tiles/explore_map'),
        arrow: loadImg('fx/projectile_arrow'),
        magic: loadImg('fx/projectile_magic'),
        labels: {
          me: t('battle.myCP') + ' ' + fmtCP(out.aCP),
          enemy: t('battle.enemyCP') + ' ' + fmtCP(out.bCP),
          win: t('battle.result.win'),
          lose: t('battle.result.lose'),
          draw: t('battle.result.draw'),
        },
      },
      () => showResult(op, out),
    );
    stopAnim = player.stop;
    skip.addEventListener('click', () => player.skip());
  };

  const showResult = (op: Opponent, out: BattleOutcome) => {
    if (cancelled) return;
    void ctx.refresh().catch(() => undefined);
    const key = out.winner === 'A' ? 'win' : out.winner === 'B' ? 'lose' : 'draw';
    const lossRows = (side: string, losses: BattleOutcome['aLosses']) =>
      h(
        'div',
        { class: 'result-col' },
        h('h3', {}, side),
        losses.length
          ? h('ul', {}, ...losses.map((l) => h('li', {}, `${unitName(l.unitId)} ×${l.count}`)))
          : h('div', { class: 'muted' }, t('battle.noLoss')),
      );
    body.replaceChildren(
      h('h2', { class: `result-title ${key}` }, t(`battle.result.${key}`)),
      h('div', { class: 'muted' }, op.title),
      h(
        'div',
        { style: 'margin:8px 0' },
        `${t('battle.myCP')} ${fmtCP(out.aCP)}  vs  ${t('battle.enemyCP')} ${fmtCP(out.bCP)}`,
      ),
      h(
        'div',
        { class: 'result-cols' },
        lossRows(t('battle.myLosses'), out.aLosses),
        lossRows(t('battle.enemyLosses'), out.bLosses),
      ),
      Object.keys(out.rewards).length
        ? h(
            'div',
            { class: 'pro', style: 'margin-top:8px' },
            `${out.stageId === 'pvp' ? t('pvp.plunder') : t('battle.reward')}: `,
            ...Object.entries(out.rewards).map((e2) =>
              h(
                'span',
                { style: `color:${RES_COLORS[e2[0]]};margin-right:10px` },
                `${t(`resource.${e2[0]}`)} +${e2[1]}`,
              ),
            ),
          )
        : h('div'),
      out.rewardCapped
        ? h('div', { class: 'con', style: 'margin-top:4px' }, t('battle.rewardCapped'))
        : h('div'),
      out.speedupMin
        ? h(
            'div',
            { class: 'pro', style: 'margin-top:4px' },
            t('battle.firstClearGot', { n: out.speedupMin }),
          )
        : h('div'),
      h(
        'div',
        { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'btn primary', onclick: () => void showList() }, t('battle.again')),
        h('button', { class: 'btn', onclick: close }, t('common.close')),
      ),
    );
  };

  void showList();
}
