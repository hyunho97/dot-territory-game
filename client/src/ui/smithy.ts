import { api } from '../api/client';
import type { EquipmentState, EquipItem } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { iconEl } from './icons';
import { costEl, errMsg, fmtDuration, openModal, once } from './panels';
import type { PanelCtx } from './panels';

export const GRADE_COLORS: Record<string, string> = {
  common: '#9e9e9e',
  uncommon: '#4caf50',
  rare: '#2196f3',
  epic: '#9c27b0',
  legendary: '#ff9800',
};
const TYPE_ICON: Record<string, string> = {
  weapon: '검',
  armor: '갑',
  shield: '방',
  accessory: '장',
};
const TYPES = ['weapon', 'armor', 'shield', 'accessory'] as const;
const GRADE_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

/** 장비 아이콘: 에셋 매니페스트(equip/<type>)가 있으면 이미지, 없으면 등급 색 플레이스홀더 */
function icon(ctx: PanelCtx, type: string, grade: string): HTMLElement {
  const path = ctx.manifest[`equip/${type}`];
  if (path) {
    const img = h('img', { class: 'eq-icon', src: `/${path}`, alt: type });
    const frame = ctx.manifest[`equip/frame_${grade}`];
    if (!frame) return img;
    // 등급 테두리를 아이콘 위에 겹쳐 그린다
    return h(
      'span',
      { class: 'eq-wrap' },
      img,
      h('img', { class: 'eq-frame', src: `/${frame}`, alt: '' }),
    );
  }
  return h(
    'div',
    {
      class: 'eq-icon placeholder',
      style: `border-color:${GRADE_COLORS[grade]};color:${GRADE_COLORS[grade]}`,
    },
    TYPE_ICON[type] ?? '?',
  );
}

export function openSmithyPanel(ctx: PanelCtx): void {
  const body = h('div', { class: 'modal-body' });
  const err = h('div', { class: 'error' });
  const serverId = ctx.getChar().serverId;
  let state: EquipmentState | null = null;
  let offset = 0;
  let timer = 0;
  const now = () => Date.now() + offset;
  let close: () => void = () => {};
  const msg = h('div', { class: 'pro' });
  let fuseSel: number[] = [];

  const itemName = (i: { type: string; grade: string }) =>
    `${t(`equip.grade.${i.grade}`)} ${t(`equip.type.${i.type}`)}`;

  const act = async (fn: () => Promise<EquipmentState>) => {
    err.textContent = '';
    try {
      state = await fn();
      offset = state.serverNow - Date.now();
      await ctx.refresh(); // 장비 보정이 전투력에 반영된 최신 상태
    } catch (e) {
      err.textContent = errMsg(e);
    }
    render();
  };

  const render = () => {
    if (!state) return;
    const st = state;
    const ch = ctx.getChar();
    const mods = ctx.race.mods;
    const sections: HTMLElement[] = [];

    sections.push(
      h(
        'div',
        { class: 'muted' },
        `${t('equip.bonus', { n: Math.round((st.multiplier - 1) * 1000) / 10 })} · ${t('equip.inventory', { n: st.items.length, max: st.maxInventory })} · ${t('equip.slots', { n: st.queue.length, max: st.craftSlots })}`,
      ),
    );
    if (!st.hasSmithy) sections.push(h('div', { class: 'error' }, t('equip.noSmithy')));

    // 장착 슬롯
    sections.push(h('h3', {}, t('equip.equipped')));
    const slotRow = h('div', { class: 'eq-slots' });
    for (const type of TYPES) {
      const it = st.items.find((x) => x.equipped && x.type === type);
      slotRow.append(
        h(
          'div',
          { class: 'eq-slot' },
          it ? icon(ctx, it.type, it.grade) : icon(ctx, type, 'common'),
          h('div', { class: 'muted' }, t(`equip.type.${type}`)),
          it
            ? h(
                'div',
                { style: `color:${GRADE_COLORS[it.grade]}` },
                `${t(`equip.grade.${it.grade}`)}${it.enhance ? ` +${it.enhance}` : ''} · +${it.effectivePower}%`,
              )
            : h('div', { class: 'muted' }, t('equip.empty')),
        ),
      );
    }
    sections.push(slotRow);

    // 제작
    sections.push(h('h3', {}, t('equip.craft')));
    for (const def of ctx.equipment.types) {
      const btn = h('button', { class: 'btn primary' }, t('equip.craftBtn'));
      (btn as HTMLButtonElement).disabled =
        !st.hasSmithy ||
        st.queue.length >= st.craftSlots ||
        st.items.length + st.queue.length >= st.maxInventory;
      btn.addEventListener('click', () => {
        (btn as HTMLButtonElement).disabled = true;
        void act(() => api.craft(serverId, def.id));
      });
      sections.push(
        h(
          'div',
          { class: 'build-card' },
          h(
            'div',
            { class: 'build-main' },
            h('strong', {}, t(`equip.type.${def.id}`)),
            h(
              'div',
              {},
              `${t('buildPanel.cost')}: `,
              costEl(def.cost, ch.resources, mods.costRate),
              h(
                'span',
                { class: 'muted' },
                `  ${t('barracks.time', { t: fmtDuration(Math.ceil(def.craftTimeSec / (mods.trainSpeed * (1 + ch.craftBonus)))) })}`,
              ),
            ),
          ),
          btn,
        ),
      );
    }
    sections.push(
      h('div', { class: 'muted' }, t('equip.chanceHint', { race: t(`race.${ch.race}.name`) })),
    );

    // 제작 큐
    sections.push(h('h3', {}, t('equip.queue')));
    if (st.queue.length === 0) sections.push(h('div', { class: 'muted' }, t('equip.queueNone')));
    for (const q of st.queue) {
      sections.push(
        h(
          'div',
          { class: 'build-row' },
          h('strong', {}, t(`equip.type.${q.type}`)),
          h(
            'span',
            { class: 'cd', 'data-finish': q.finishAt },
            t('barracks.ready', { t: fmtDuration((q.finishAt - now()) / 1000) }),
          ),
        ),
      );
    }

    // 인벤토리
    sections.push(h('h3', {}, t('equip.items')));
    if (st.items.length === 0) sections.push(h('div', { class: 'muted' }, t('equip.itemsNone')));
    const sorted = [...st.items].sort(
      (a, b) =>
        Number(b.equipped) - Number(a.equipped) ||
        GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) ||
        b.power - a.power,
    );
    fuseSel = fuseSel.filter((id) => st.items.some((x) => x.id === id && !x.equipped));
    sections.push(fusePanel(st));
    for (const it of sorted) sections.push(itemRow(it));
    body.replaceChildren(msg, ...sections, err);
  };

  const st_hasSmithy = (): boolean => state?.hasSmithy ?? false;

  const doEnhance = async (it: EquipItem) => {
    err.textContent = '';
    msg.textContent = '';
    try {
      const r = await api.enhanceItem(serverId, it.id);
      state = r;
      offset = r.serverNow - Date.now();
      if (r.result === 'success')
        msg.textContent = t('equip.enhanceSuccess', { n: it.enhance + 1 });
      else if (r.result === 'promoted') {
        const now2 = r.items.find((x) => x.id === it.id);
        msg.textContent = t('equip.promoted', {
          name: t(`equip.type.${it.type}`),
          grade: t(`equip.grade.${now2?.grade ?? it.grade}`),
        });
        if (now2)
          playCraftFx(ctx, `${t(`equip.grade.${now2.grade}`)} ${t(`equip.type.${now2.type}`)}`);
      } else msg.textContent = t('equip.enhanceFail');
      msg.className = r.result === 'fail' ? 'con' : 'pro';
      await ctx.refresh();
    } catch (e) {
      err.textContent = errMsg(e);
    }
    render();
  };

  const fusePanel = (st: EquipmentState): HTMLElement => {
    const sel = fuseSel
      .map((id) => st.items.find((x) => x.id === id))
      .filter(Boolean) as EquipItem[];
    const grade = sel[0]?.grade;
    const box = h(
      'div',
      { class: 'build-card' },
      h(
        'div',
        { class: 'build-main' },
        h('strong', {}, t('equip.fuseHeading')),
        h('div', { class: 'muted' }, t('equip.fuseHint')),
        h(
          'div',
          {},
          t('equip.fuseSlot', { n: sel.length }),
          sel.length ? ` · ${sel.map(itemName).join(' + ')}` : '',
        ),
        grade && ctx.equipment.grades.some((g) => g.id === grade)
          ? h(
              'div',
              { class: 'pro' },
              t('equip.fuseInfo', {
                grade: t(`equip.grade.${grade}`),
                next: t(
                  `equip.grade.${ctx.equipment.grades[ctx.equipment.grades.findIndex((g) => g.id === grade) + 1]?.id ?? grade}`,
                ),
                pct: Math.round((ctx.equipment.fusion.chance[grade] ?? 0) * 1000) / 10,
                cost: Object.entries(ctx.equipment.fusion.cost)
                  .map(([k, v]) => `${t(`resource.${k}`)} ${v}`)
                  .join(' '),
              }),
            )
          : null,
      ),
    );
    const go = h('button', { class: 'btn primary' }, t('equip.fuseBtn'));
    (go as HTMLButtonElement).disabled = sel.length !== 2 || !st.hasSmithy;
    go.addEventListener('click', async () => {
      (go as HTMLButtonElement).disabled = true;
      err.textContent = '';
      msg.textContent = '';
      try {
        const r = await api.fuseItems(serverId, sel[0].id, sel[1].id);
        state = r;
        offset = r.serverNow - Date.now();
        fuseSel = [];
        if (r.fuse.success && r.fuse.item) {
          const name = `${t(`equip.grade.${r.fuse.item.grade}`)} ${t(`equip.type.${r.fuse.item.type}`)}`;
          msg.textContent = t('equip.fuseSuccess', { name });
          msg.className = 'pro';
          playCraftFx(ctx, name);
        } else {
          msg.textContent = t('equip.fuseFail');
          msg.className = 'con';
        }
        await ctx.refresh();
      } catch (e) {
        err.textContent = errMsg(e);
      }
      render();
    });
    const clr = h('button', { class: 'btn' }, t('equip.fuseClear'));
    clr.addEventListener('click', () => {
      fuseSel = [];
      render();
    });
    box.append(h('div', { class: 'col' }, go, clr));
    return box;
  };

  const itemRow = (it: EquipItem): HTMLElement => {
    const equipBtn = h(
      'button',
      { class: 'btn' },
      it.equipped ? t('equip.unequip') : t('equip.equip'),
    );
    equipBtn.addEventListener(
      'click',
      () =>
        void act(() => (it.equipped ? api.unequip(serverId, it.id) : api.equip(serverId, it.id))),
    );
    const salvageBtn = h('button', { class: 'btn' }, t('equip.salvage'));
    (salvageBtn as HTMLButtonElement).disabled = it.equipped;
    salvageBtn.addEventListener('click', () => void act(() => api.salvage(serverId, it.id)));
    // 강화: 최대 단계면 비활성, 다음 단계가 승급이면 "승급 도전"
    const E = ctx.equipment.enhance;
    const maxed = it.enhance >= E.maxLevel;
    const gradeIdx = ctx.equipment.grades.findIndex((g) => g.id === it.grade);
    const nextGradeId = ctx.equipment.grades[gradeIdx + 1]?.id;
    const promoting = !maxed && it.enhance + 1 >= E.maxLevel && !!nextGradeId;
    const mult = (1 + it.enhance * E.levelGrowth) * (1 + gradeIdx * E.gradeGrowth);
    const eCost: Record<string, number> = {};
    for (const [k, v] of Object.entries(E.cost)) eCost[k] = Math.ceil(v * mult);
    const pct = Math.round(
      (E.successRate[Math.min(it.enhance, E.successRate.length - 1)] ?? 0) * 100,
    );
    const enhBtn = h(
      'button',
      { class: 'btn primary' },
      promoting ? t('equip.promoteBtn') : t('equip.enhanceBtn'),
    );
    (enhBtn as HTMLButtonElement).disabled = maxed || !st_hasSmithy();
    enhBtn.addEventListener('click', () => {
      (enhBtn as HTMLButtonElement).disabled = true;
      void doEnhance(it);
    });
    const picked = fuseSel.includes(it.id);
    const fuseBtn = h(
      'button',
      { class: 'btn' },
      picked ? t('equip.fusePicked') : t('equip.fusePick'),
    );
    const fuseGrade = state ? state.items.find((x) => x.id === fuseSel[0])?.grade : undefined;
    (fuseBtn as HTMLButtonElement).disabled =
      it.equipped ||
      !(ctx.equipment.fusion.chance[it.grade] > 0) ||
      (fuseSel.length >= 2 && !picked) ||
      (!!fuseGrade && fuseGrade !== it.grade && !picked);
    fuseBtn.addEventListener('click', () => {
      fuseSel = picked ? fuseSel.filter((x) => x !== it.id) : [...fuseSel, it.id];
      render();
    });
    return h(
      'div',
      {
        class: `unit-card${picked ? ' picked' : ''}`,
        style: `border-color:${GRADE_COLORS[it.grade]}`,
      },
      icon(ctx, it.type, it.grade),
      h(
        'div',
        { class: 'info' },
        h(
          'strong',
          { style: `color:${GRADE_COLORS[it.grade]}` },
          itemName(it),
          it.enhance
            ? h('span', { class: 'enh-tag' }, ` ${t('equip.enhanceTag', { n: it.enhance })}`)
            : '',
        ),
        h('div', { class: 'muted' }, t('equip.power', { n: it.effectivePower })),
        maxed
          ? h('div', { class: 'muted' }, t('equip.enhanceMax'))
          : h(
              'div',
              { class: 'muted' },
              promoting
                ? t('equip.promoteInfo', {
                    from: it.enhance,
                    grade: t(`equip.grade.${nextGradeId}`),
                    pct,
                  })
                : t('equip.enhanceInfo', { from: it.enhance, to: it.enhance + 1, pct }),
              ' · ',
              costEl(eCost, ctx.getChar().resources, 1),
            ),
        it.equipped ? h('span', { class: 'badge mine' }, t('equip.worn')) : null,
      ),
      h('div', { class: 'col' }, enhBtn, h('div', { class: 'row' }, equipBtn, fuseBtn, salvageBtn)),
    );
  };

  close = openModal(t('equip.heading'), body, () => clearInterval(timer), true);
  body.replaceChildren(h('div', { class: 'muted' }, t('common.loading')));
  const load = async () => {
    try {
      const before = new Set((state?.items ?? []).map((i) => i.id));
      const next = await api.equipment(serverId);
      // 패널을 연 채로 제작이 끝나면 새로 생긴 장비로 완료 연출을 보여 준다
      const fresh = state ? next.items.find((i) => !before.has(i.id)) : undefined;
      state = next;
      if (fresh)
        playCraftFx(
          ctx,
          `${t(`equip.grade.${fresh.grade}`)} ${t(`equip.type.${fresh.type}`)} (+${fresh.power}%)`,
        );
      offset = state.serverNow - Date.now();
    } catch (e) {
      err.textContent = errMsg(e);
    }
    render();
  };
  void load();
  const tick = once(() =>
    load()
      .then(() => ctx.refresh())
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

/** 제작 완료 연출: 이펙트 이미지가 커지며 사라지고, 완성품 이름을 잠시 보여 준다 */
function playCraftFx(ctx: PanelCtx, label: string): void {
  const fx = iconEl('fx/craft_complete', 128, ctx.manifest);
  const box = h(
    'div',
    { class: 'craft-fx' },
    fx ?? '',
    h('div', { class: 'craft-fx-text' }, t('equip.craftDone', { name: label })),
  );
  document.body.append(box);
  window.setTimeout(() => box.remove(), 1800);
}
