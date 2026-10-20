import { ApiError, api } from '../api/client';
import type {
  BuildingData,
  CharacterState,
  ExploreNode,
  ExploreState,
  RaceData,
  TerritoryLevelData,
  UnitData,
  EquipmentData,
} from '../api/client';
import { errorMessage, t } from '../i18n';
import { buildingThumb } from './buildingSprite';
import { h } from './dom';
import { iconEl } from './icons';

export const RES_COLORS: Record<string, string> = {
  food: '#8bc34a',
  wood: '#8d6e63',
  stone: '#b0bec5',
  iron: '#78909c',
  gold: '#ffd54f',
};

export interface PanelCtx {
  getChar(): CharacterState;
  /** 서버에서 최신 영지 상태를 다시 받아 상단 바/맵에 반영 */
  refresh(): Promise<CharacterState>;
  race: RaceData;
  buildings: BuildingData[];
  categories: string[];
  upgrade: { costGrowth: number; timeGrowth: number };
  spriteTiers: number[];
  levels: TerritoryLevelData[];
  units: UnitData[];
  manifest: Record<string, string>;
  equipment: EquipmentData;
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

export function errMsg(e: unknown): string {
  return errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN');
}

/** 모달 껍데기. close() 시 타이머 정리 콜백 실행 */
/** 동시에 한 번만 실행되는 비동기 작업 래퍼 (타이머가 완료 후 갱신 요청을 매초 쏟아내지 않도록) */
export function once(fn: () => Promise<unknown>): () => void {
  let running = false;
  return () => {
    if (running) return;
    running = true;
    void fn()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
}

const openModals = new Set<() => void>();
/** 화면 전환/로그아웃 시 열려 있는 모달을 모두 닫는다 (모달별 타이머 정리 콜백 포함) */
export function closeAllModals(): void {
  for (const close of [...openModals]) close();
}

export function openModal(
  title: string,
  body: HTMLElement,
  onClose: () => void,
  wide = false,
): () => void {
  const overlay = h('div', { class: 'modal-overlay' });
  const close = () => {
    if (!openModals.delete(close)) return; // 이미 닫힘
    onClose();
    overlay.remove();
  };
  openModals.add(close);
  overlay.addEventListener('mousedown', (ev) => ev.target === overlay && close());
  overlay.append(
    h(
      'div',
      { class: `panel modal${wide ? ' wide' : ''}` },
      h(
        'div',
        { class: 'modal-head' },
        h('h2', {}, title),
        h('button', { class: 'btn', onclick: close }, t('common.close')),
      ),
      body,
    ),
  );
  document.body.append(overlay);
  return close;
}

export function costEl(
  cost: Record<string, number>,
  res: Record<string, number>,
  rate: number,
): HTMLElement {
  const wrap = h('span', { class: 'cost' });
  for (const [k, v] of Object.entries(cost)) {
    const need = Math.ceil(v * rate);
    wrap.append(
      h(
        'span',
        { class: res[k] >= need ? 'cost-ok' : 'cost-short' },
        `${t(`resource.${k}`)} ${need}`,
      ),
    );
  }
  return wrap;
}

/** 진행 중 타이머 옆에 붙는 가속 버튼 줄 (보유량이 없으면 안내만) */
export function speedupRow(
  ctx: PanelCtx,
  target: 'levelup' | 'building' | 'research',
  buildingId: number | undefined,
  onDone: () => void,
): HTMLElement {
  const have = ctx.getChar().speedupSec;
  const row = h('span', { class: 'speedup-row' });
  const err = h('span', { class: 'con' });
  const mk = (label: string, sec: number) => {
    const btn = h('button', { class: 'btn' }, label);
    (btn as HTMLButtonElement).disabled = have <= 0;
    btn.addEventListener('click', async () => {
      (btn as HTMLButtonElement).disabled = true;
      try {
        await api.speedup(ctx.getChar().serverId, target, sec, buildingId);
        await ctx.refresh();
        onDone();
      } catch (e) {
        err.textContent = errMsg(e);
      }
    });
    return btn;
  };
  row.append(
    iconEl('icons/speedup', 18, ctx.manifest) ?? '',
    h('span', { class: 'muted' }, t('speedup.have', { t: fmtDuration(have) })),
    mk(t('speedup.use10'), 600),
    mk(t('speedup.use60'), 3600),
    mk(t('speedup.all'), Math.max(have, 1)),
    err,
  );
  return row;
}

// ───────────────── 영지(건물) 패널 ─────────────────

/** 건물 썸네일(종족/레벨 단계별 이미지, 없으면 색 사각형) */
function bThumb(ctx: PanelCtx, type: string, level: number, color: string, size = 48): HTMLElement {
  return buildingThumb(ctx.manifest, ctx.spriteTiers, ctx.race.id, type, level, color, size);
}

export function openBuildingPanel(ctx: PanelCtx, focusType?: string): void {
  const body = h('div', { class: 'modal-body' });
  const err = h('div', { class: 'error' });
  let timer = 0;
  let close: () => void = () => {};
  let offset = ctx.getChar().serverNow - Date.now();
  const now = () => Date.now() + offset;

  const render = () => {
    const ch = ctx.getChar();
    offset = ch.serverNow - Date.now();
    const rate = ch.race === ctx.race.id ? ctx.race.mods.costRate : 1;
    const active = ch.buildings.filter(
      (b) =>
        (b.finishAt !== null && b.finishAt > now()) ||
        (b.upgradeFinishAt !== null && b.upgradeFinishAt > now()),
    );

    const sections: HTMLElement[] = [
      h(
        'div',
        { class: 'muted' },
        `${t('territory.level', { n: ch.territoryLevel })} · ${t('buildPanel.slots', {
          n: active.length,
          max: ch.buildSlots,
        })}`,
      ),
    ];

    // 영지 레벨업
    const nextLv = ctx.levels.find((l) => l.level === ch.territoryLevel + 1);
    const lvBox = h('div', { class: 'build-card levelup' });
    const lvMain = h('div', { class: 'build-main' });
    lvMain.append(h('h3', { style: 'margin:0;color:var(--gold)' }, t('levelUp.heading')));
    if (ch.levelUp) {
      lvMain.append(
        h(
          'div',
          {},
          t('levelUp.inProgress', { to: ch.levelUp.to }),
          h(
            'span',
            { class: 'cd', 'data-finish': ch.levelUp.finishAt },
            `  ${t('buildPanel.remaining', { t: fmtDuration((ch.levelUp.finishAt - now()) / 1000) })}`,
          ),
        ),
        speedupRow(ctx, 'levelup', undefined, render),
      );
    } else if (!nextLv || !nextLv.cost) {
      lvMain.append(h('div', { class: 'muted' }, t('levelUp.max')));
    } else {
      const lvCost = nextLv.cost;
      const unlocked = ctx.buildings
        .filter((b) => b.unlockLevel === nextLv.level && b.buildable)
        .map((b) => t(`building.${b.id}`));
      lvMain.append(
        h(
          'div',
          { class: 'row', style: 'justify-content:flex-start' },
          bThumb(ctx, 'town_hall', ch.territoryLevel, '#e8b830', 64),
          h('span', {}, '→'),
          bThumb(ctx, 'town_hall', nextLv.level, '#e8b830', 64),
          h('span', {}, t('levelUp.next', { from: ch.territoryLevel, to: nextLv.level })),
        ),
        h(
          'div',
          {},
          `${t('buildPanel.cost')}: `,
          costEl(lvCost, ch.resources, rate),
          h(
            'span',
            { class: 'muted' },
            `  ${t('buildPanel.time')} ${fmtDuration(nextLv.timeSec ?? 0)}`,
          ),
        ),
        h(
          'div',
          { class: 'pro' },
          `${t('levelUp.unlocks')}: ${[
            t('levelUp.maxTroops', { n: nextLv.maxTroops }),
            t('levelUp.tier', { n: nextLv.unlockTier }),
            ...(unlocked.length ? [t('levelUp.buildings', { list: unlocked.join(', ') })] : []),
          ].join(' · ')}`,
        ),
      );
      const lvBtn = h('button', { class: 'btn primary' }, t('levelUp.start'));
      lvBtn.addEventListener('click', async () => {
        err.textContent = '';
        (lvBtn as HTMLButtonElement).disabled = true;
        try {
          await api.levelUp(ch.serverId);
          await ctx.refresh();
        } catch (e) {
          err.textContent = errMsg(e);
        }
        render();
      });
      lvBox.append(lvMain, lvBtn);
    }
    if (!lvBox.firstChild) lvBox.append(lvMain);
    if (!focusType || focusType === 'town_hall') sections.push(lvBox);

    // 건설 중
    const ing = h('div', { class: 'build-row-list' });
    if (active.length === 0)
      ing.append(h('div', { class: 'muted' }, t('buildPanel.constructingNone')));
    for (const b of active) {
      const fin = Math.max(b.finishAt ?? 0, b.upgradeFinishAt ?? 0);
      const label =
        b.upgradeFinishAt && b.upgradeFinishAt > now() && !(b.finishAt && b.finishAt > now())
          ? `${t(`building.${b.type}`)} → Lv.${b.upgradeTo ?? b.level + 1}`
          : t(`building.${b.type}`);
      ing.append(
        h(
          'div',
          { class: 'build-row' },
          h(
            'span',
            {},
            (label === t(`building.${b.type}`) &&
              iconEl('buildings/under_construction', 32, ctx.manifest)) ||
              '',
            h('strong', {}, ` ${label}`),
          ),
          h(
            'span',
            { class: 'cd', 'data-finish': fin },
            t('buildPanel.remaining', { t: fmtDuration((fin - now()) / 1000) }),
          ),
          speedupRow(ctx, 'building', b.id, render),
        ),
      );
    }
    sections.push(h('h3', {}, t('buildPanel.constructing')), ing);

    // 보유 건물 업그레이드
    const upgradable = ch.buildings.filter(
      (b) =>
        ctx.buildings.find((x) => x.id === b.type)?.maxLevel &&
        (!focusType || b.type === focusType),
    );
    if (upgradable.length > 0) {
      sections.push(h('h3', { class: 'cat' }, t('upgrade.heading')));
      for (const b of upgradable) {
        const def = ctx.buildings.find((x) => x.id === b.type)!;
        const maxLv = def.maxLevel ?? 1;
        const constructing = b.finishAt !== null && b.finishAt > now();
        const upgrading = b.upgradeFinishAt !== null && b.upgradeFinishAt > now();
        const effectAt = (lv: number): string => {
          const parts: string[] = [];
          if (def.production)
            parts.push(
              `${t(`resource.${def.production.resource}`)} ${t('buildPanel.prod', { n: def.production.perHour * lv })}`,
            );
          if (def.popBonus) parts.push(t('buildPanel.pop', { n: def.popBonus * lv }));
          if (def.storageBonus) parts.push(t('buildPanel.store', { n: def.storageBonus * lv }));
          if (def.speedBonus)
            parts.push(
              t(
                def.speedBonus.kind === 'train' ? 'buildPanel.speedTrain' : 'buildPanel.speedCraft',
                {
                  n: Math.round(def.speedBonus.perLevel * (lv - 1) * 100),
                },
              ),
            );
          return parts.join(' · ');
        };
        const cost: Record<string, number> = {};
        for (const [k, v] of Object.entries(def.cost))
          cost[k] = Math.ceil(v * Math.pow(ctx.upgrade.costGrowth, b.level));
        const sec = Math.ceil(def.buildTimeSec * Math.pow(ctx.upgrade.timeGrowth, b.level));

        let action: HTMLElement;
        if (constructing) {
          action = h('span', { class: 'badge' }, t('upgrade.constructing'));
        } else if (upgrading) {
          action = h(
            'span',
            { class: 'cd', 'data-finish': b.upgradeFinishAt ?? 0 },
            t('buildPanel.remaining', {
              t: fmtDuration(((b.upgradeFinishAt ?? 0) - now()) / 1000),
            }),
          );
        } else if (b.level >= maxLv) {
          action = h('span', { class: 'badge' }, t('upgrade.maxLevel'));
        } else if (b.level >= ch.territoryLevel) {
          action = h('span', { class: 'con' }, t('upgrade.needTerritory', { n: b.level + 1 }));
        } else {
          const btn = h('button', { class: 'btn primary' }, t('upgrade.btn'));
          (btn as HTMLButtonElement).disabled = active.length >= ch.buildSlots;
          btn.addEventListener('click', async () => {
            err.textContent = '';
            (btn as HTMLButtonElement).disabled = true;
            try {
              await api.upgradeBuilding(ch.serverId, b.id);
              await ctx.refresh();
            } catch (e) {
              err.textContent = errMsg(e);
            }
            render();
          });
          action = btn;
        }
        const canNext =
          !constructing && !upgrading && b.level < maxLv && b.level < ch.territoryLevel;
        sections.push(
          h(
            'div',
            { class: 'build-card' },
            h(
              'div',
              { class: 'build-main' },
              h(
                'div',
                {},
                bThumb(ctx, def.id, b.level, def.color),
                h('strong', {}, ` ${t(`building.${def.id}`)} `),
                h('span', { class: 'lvl' }, t('upgrade.level', { n: b.level })),
                upgrading
                  ? h(
                      'span',
                      { class: 'muted' },
                      `  ${t('upgrade.upgrading', { n: b.upgradeTo ?? b.level + 1 })}`,
                    )
                  : null,
              ),
              h(
                'div',
                { class: 'pro' },
                canNext ? `${effectAt(b.level)}  →  ${effectAt(b.level + 1)}` : effectAt(b.level),
              ),
              canNext
                ? h(
                    'div',
                    {},
                    `${t('buildPanel.cost')}: `,
                    costEl(cost, ch.resources, rate),
                    h('span', { class: 'muted' }, `  ${t('buildPanel.time')} ${fmtDuration(sec)}`),
                  )
                : null,
            ),
            action,
          ),
        );
      }
    }

    // 카테고리별 건물 목록
    for (const cat of ctx.categories) {
      const defs = ctx.buildings.filter(
        (b) => b.category === cat && b.buildable && (!focusType || b.id === focusType),
      );
      if (defs.length === 0) continue;
      sections.push(h('h3', { class: 'cat' }, t(`category.${cat}`)));
      for (const def of defs) {
        const count = ch.buildings.filter((b) => b.type === def.id).length;
        const locked = def.unlockLevel > ch.territoryLevel;
        const maxed = count >= def.maxCount;
        const effects: string[] = [];
        if (def.production)
          effects.push(
            `${t(`resource.${def.production.resource}`)} ${t('buildPanel.prod', { n: def.production.perHour })}`,
          );
        if (def.popBonus) effects.push(t('buildPanel.pop', { n: def.popBonus }));
        if (def.storageBonus) effects.push(t('buildPanel.store', { n: def.storageBonus }));

        const btn = h('button', { class: 'btn primary' }, t('buildPanel.build'));
        (btn as HTMLButtonElement).disabled = locked || maxed || active.length >= ch.buildSlots;
        btn.addEventListener('click', async () => {
          err.textContent = '';
          (btn as HTMLButtonElement).disabled = true;
          try {
            await api.build(ch.serverId, def.id);
            await ctx.refresh();
          } catch (e) {
            err.textContent = errMsg(e);
          }
          render();
        });

        sections.push(
          h(
            'div',
            { class: `build-card${locked ? ' locked' : ''}` },
            h(
              'div',
              { class: 'build-main' },
              h(
                'div',
                {},
                bThumb(ctx, def.id, 1, def.color),
                h('strong', {}, ` ${t(`building.${def.id}`)}`),
                h(
                  'span',
                  { class: 'muted' },
                  `  ${t('buildPanel.built', { n: count, max: def.maxCount })}`,
                ),
              ),
              h('div', { class: 'muted' }, t(`buildingDesc.${def.id}`)),
              effects.length ? h('div', { class: 'pro' }, effects.join(' · ')) : null,
              locked
                ? h('div', { class: 'con' }, t('buildPanel.locked', { n: def.unlockLevel }))
                : h(
                    'div',
                    {},
                    `${t('buildPanel.cost')}: `,
                    costEl(def.cost, ch.resources, rate),
                    h(
                      'span',
                      { class: 'muted' },
                      `  ${t('buildPanel.time')} ${fmtDuration(def.buildTimeSec)}`,
                    ),
                  ),
            ),
            maxed ? h('span', { class: 'badge' }, t('buildPanel.maxed')) : btn,
          ),
        );
      }
    }
    body.replaceChildren(...sections, err);
  };

  render();
  close = openModal(focusType ? t(`building.${focusType}`) : t('buildPanel.heading'), body, () =>
    clearInterval(timer),
  );
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
      el.textContent = t('buildPanel.remaining', { t: fmtDuration(left) });
      if (left <= 0) finished = true;
    });
    if (finished) tick();
  }, 1000);
}

// ───────────────── 탐사 패널 ─────────────────

const MAP_PX = 560;
const MAP_RADIUS = 13;

export function openExplorePanel(ctx: PanelCtx): void {
  const serverId = ctx.getChar().serverId;
  let state: ExploreState | null = null;
  let offset = 0;
  let selected: ExploreNode | null = null;
  let timer = 0;
  const now = () => Date.now() + offset;

  const canvas = h('canvas', { width: MAP_PX, height: MAP_PX, class: 'explore-canvas' });
  const side = h('div', { class: 'explore-side' });
  const err = h('div', { class: 'error' });
  const body = h('div', { class: 'explore-layout' }, canvas, side);
  const scale = (MAP_PX / 2 - 16) / MAP_RADIUS;
  const toPx = (x: number, y: number): [number, number] => [
    MAP_PX / 2 + x * scale,
    MAP_PX / 2 + y * scale,
  ];

  const mapImg = new Image();
  if (ctx.manifest['tiles/explore_map']) {
    mapImg.onload = () => draw();
    mapImg.src = `/${ctx.manifest['tiles/explore_map']}`;
  }
  const grass = new Image();
  if (ctx.manifest['tiles/grass']) {
    grass.onload = () => draw();
    grass.src = `/${ctx.manifest['tiles/grass']}`;
  }

  const draw = () => {
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1c2a1a';
    g.fillRect(0, 0, MAP_PX, MAP_PX);
    if (mapImg.complete && mapImg.naturalWidth > 0) {
      g.drawImage(mapImg, 0, 0, MAP_PX, MAP_PX);
      g.fillStyle = 'rgba(10,12,20,0.35)'; // 노드/글자가 잘 보이도록 약간 어둡게
      g.fillRect(0, 0, MAP_PX, MAP_PX);
    } else if (grass.complete && grass.naturalWidth > 0) {
      g.fillStyle = g.createPattern(grass, 'repeat') ?? '#1c2a1a';
      g.fillRect(0, 0, MAP_PX, MAP_PX);
      g.fillStyle = 'rgba(10,12,20,0.45)'; // 노드/글자가 잘 보이도록 어둡게
      g.fillRect(0, 0, MAP_PX, MAP_PX);
    }
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (let i = -MAP_RADIUS; i <= MAP_RADIUS; i++) {
      const [px] = toPx(i, 0);
      const [, py] = toPx(0, i);
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, MAP_PX);
      g.moveTo(0, py);
      g.lineTo(MAP_PX, py);
      g.stroke();
    }
    g.font = '12px DotGothic16, monospace';
    for (const r of [3, 6, 9, 12]) {
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.arc(MAP_PX / 2, MAP_PX / 2, r * scale, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillText(String(r), MAP_PX / 2 + r * scale - 12, MAP_PX / 2 - 4);
    }
    if (!state) return;
    for (const e of state.expeditions) {
      const [x, y] = toPx(e.x, e.y);
      g.strokeStyle = '#ff9800';
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(MAP_PX / 2, MAP_PX / 2);
      g.lineTo(x, y);
      g.stroke();
      g.setLineDash([]);
    }
    for (const n of state.nodes) {
      const [x, y] = toPx(n.x, n.y);
      g.fillStyle = RES_COLORS[n.resource] ?? '#fff';
      g.fillRect(x - 8, y - 8, 16, 16);
      g.strokeStyle = n.id === selected?.id ? '#fff' : '#000';
      g.lineWidth = n.id === selected?.id ? 3 : 2;
      g.strokeRect(x - 8, y - 8, 16, 16);
      g.fillStyle = '#000';
      g.fillText(t(`resource.${n.resource}`).slice(0, 1), x - 5, y + 4);
    }
    // 내 영지
    g.fillStyle = '#e8b830';
    g.fillRect(MAP_PX / 2 - 12, MAP_PX / 2 - 12, 24, 24);
    g.strokeStyle = '#000';
    g.lineWidth = 3;
    g.strokeRect(MAP_PX / 2 - 12, MAP_PX / 2 - 12, 24, 24);
    g.fillStyle = '#fff';
    g.fillText(t('explore.castle'), MAP_PX / 2 - 20, MAP_PX / 2 + 28);
  };

  const renderSide = () => {
    if (!state) return;
    const st = state;
    const gain = ctx.race.mods.resourceGain;
    const items: HTMLElement[] = [
      h('div', {}, t('explore.idle', { n: st.idleTroops })),
      h('div', { class: 'muted' }, t('explore.slots', { n: st.expeditions.length, max: st.slots })),
    ];

    if (!selected) {
      items.push(h('div', { class: 'muted', style: 'margin:12px 0' }, t('explore.select')));
    } else {
      const n = selected;
      const dist = Math.hypot(n.x, n.y);
      const roundTrip = Math.ceil(dist * st.tileSec) * 2;
      const maxByNode = Math.max(1, Math.ceil(n.remaining / (st.carryPerUnit * gain)));
      const maxTroops = Math.max(0, Math.min(st.idleTroops, maxByNode));
      const input = h('input', {
        class: 'input',
        type: 'number',
        min: 1,
        max: maxTroops,
        value: Math.min(maxTroops, 1),
      });
      const expected = h('div', { class: 'pro' });
      const upd = () => {
        const tr = Math.max(0, Math.floor(Number(input.value) || 0));
        expected.textContent = t('explore.expected', {
          n: Math.min(n.remaining, Math.floor(tr * st.carryPerUnit * gain)),
        });
      };
      input.addEventListener('input', upd);
      upd();
      const send = h('button', { class: 'btn primary' }, t('explore.send'));
      (send as HTMLButtonElement).disabled = maxTroops < 1 || st.expeditions.length >= st.slots;
      send.addEventListener('click', async () => {
        err.textContent = '';
        (send as HTMLButtonElement).disabled = true;
        try {
          state = await api.sendExpedition(serverId, n.id, Number(input.value));
          offset = state.serverNow - Date.now();
          selected = state.nodes.find((x) => x.id === n.id) ?? null;
          await ctx.refresh();
        } catch (e) {
          err.textContent = errMsg(e);
        }
        draw();
        renderSide();
      });
      items.push(
        h('h3', { style: `color:${RES_COLORS[n.resource]}` }, t(`resource.${n.resource}`)),
        h('div', {}, t('explore.distance', { n: dist.toFixed(1) })),
        h('div', {}, t('explore.remaining', { n: n.remaining })),
        h('div', {}, t('explore.roundTrip', { t: fmtDuration(roundTrip) })),
        h('label', { style: 'display:block;margin-top:8px' }, t('explore.troops')),
        input,
        expected,
        h('div', { style: 'height:8px' }),
        send,
      );
    }

    items.push(h('h3', { style: 'margin-top:16px' }, t('explore.active')));
    if (st.expeditions.length === 0)
      items.push(h('div', { class: 'muted' }, t('explore.activeNone')));
    for (const e of st.expeditions) {
      items.push(
        h(
          'div',
          { class: 'build-row' },
          h(
            'span',
            { style: `color:${RES_COLORS[e.resource]}` },
            t('explore.item', {
              resource: t(`resource.${e.resource}`),
              n: e.troops,
              y: e.yield,
            }),
          ),
          h(
            'span',
            { class: 'cd', 'data-finish': e.finishAt },
            t('explore.back', { t: fmtDuration((e.finishAt - now()) / 1000) }),
          ),
        ),
      );
    }
    side.replaceChildren(...items, err);
  };

  const load = async () => {
    try {
      state = await api.explore(serverId);
      offset = state.serverNow - Date.now();
      if (selected) selected = state.nodes.find((n) => n.id === selected!.id) ?? null;
    } catch (e) {
      err.textContent = errMsg(e);
    }
    draw();
    renderSide();
  };

  canvas.addEventListener('click', (ev) => {
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    const k = MAP_PX / rect.width;
    const mx = (ev.clientX - rect.left) * k;
    const my = (ev.clientY - rect.top) * k;
    let best: ExploreNode | null = null;
    let bestD = 18;
    for (const n of state.nodes) {
      const [x, y] = toPx(n.x, n.y);
      const d = Math.hypot(mx - x, my - y);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    selected = best;
    draw();
    renderSide();
  });

  openModal(t('explore.heading'), body, () => clearInterval(timer), true);
  void load();
  const tick = once(() => load().then(() => ctx.refresh()));
  timer = window.setInterval(() => {
    let finished = false;
    side.querySelectorAll<HTMLElement>('.cd').forEach((el) => {
      const left = (Number(el.dataset.finish) - now()) / 1000;
      el.textContent = t('explore.back', { t: fmtDuration(left) });
      if (left <= 0) finished = true;
    });
    if (finished) tick();
  }, 1000);
}
