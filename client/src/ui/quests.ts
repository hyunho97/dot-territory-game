import { api } from '../api/client';
import type { GrantSummary, QuestView, QuestsState } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { errMsg, fmtDuration, openModal } from './panels';
import type { PanelCtx } from './panels';

type Tab = 'tutorial' | 'daily' | 'attendance';

/** 받을 수 있는 보상이 있는지 (상단 버튼 알림 표시용) */
export function hasClaimable(q: QuestsState): boolean {
  const ready = (list: QuestView[]) => list.some((x) => x.progress >= x.count && !x.claimed);
  return (
    ready(q.tutorial) ||
    ready(q.daily) ||
    (q.dailyBonus.complete && !q.dailyBonus.claimed && q.daily.every((d) => d.claimed)) ||
    q.attendance.canClaim
  );
}

function rewardText(reward: Record<string, number>): string {
  return Object.entries(reward)
    .map(([k, v]) =>
      k === 'equipment'
        ? t('quest.equipBox', { n: v })
        : k === 'speedup'
          ? t('quest.speedup', { n: v })
          : `${t(`resource.${k}`)} ${v}`,
    )
    .join(' · ');
}

function grantText(s: GrantSummary): string {
  const parts = Object.entries(s.resources)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${t(`resource.${k}`)} +${v}`);
  if (s.speedupMin) parts.push(t('quest.speedup', { n: s.speedupMin }));
  if (s.equipment)
    parts.push(
      t('quest.gotEquip', {
        name: `${t(`equip.grade.${s.equipment.grade}`)} ${t(`equip.type.${s.equipment.type}`)} (+${s.equipment.power}%)`,
      }),
    );
  return parts.length ? t('quest.got', { list: parts.join(', ') }) : t('quest.capNote');
}

export function openQuestPanel(ctx: PanelCtx, onChange: (q: QuestsState) => void): void {
  const serverId = ctx.getChar().serverId;
  const body = h('div', { class: 'modal-body' });
  const msg = h('div', { class: 'pro' });
  const err = h('div', { class: 'error' });
  let state: QuestsState | null = null;
  let tab: Tab | null = null;
  let offset = 0;
  let timer = 0;
  const now = () => Date.now() + offset;

  const apply = (q: QuestsState) => {
    state = q;
    offset = q.serverNow - Date.now();
    onChange(q);
  };

  const claim = async (fn: () => Promise<{ summary: GrantSummary; quests: QuestsState }>) => {
    err.textContent = '';
    msg.textContent = '';
    try {
      const r = await fn();
      apply(r.quests);
      msg.textContent = grantText(r.summary);
    } catch (e) {
      err.textContent = errMsg(e);
    }
    render();
    await ctx.refresh().catch(() => undefined); // 수령은 이미 끝났으므로 갱신 실패는 무시
  };

  const questRow = (q: QuestView, hint?: boolean): HTMLElement => {
    const done = q.progress >= q.count;
    const btn = h('button', { class: 'btn primary' }, t('common.claim'));
    (btn as HTMLButtonElement).disabled = !done || q.claimed;
    btn.addEventListener('click', () => void claim(() => api.claimQuest(serverId, q.id)));
    return h(
      'div',
      { class: `build-card${q.claimed ? ' locked' : ''}` },
      h(
        'div',
        { class: 'build-main' },
        h('strong', {}, t(`quest.name.${q.id}`)),
        hint ? h('div', { class: 'muted' }, t(`quest.hint.${q.id}`)) : null,
        h(
          'div',
          { class: done ? 'pro' : 'muted' },
          t('quest.progress', { n: Math.floor(q.progress), max: q.count }),
        ),
        h('div', { class: 'muted' }, `${t('quest.reward')}: ${rewardText(q.reward)}`),
      ),
      q.claimed ? h('span', { class: 'badge' }, t('quest.claimed')) : btn,
    );
  };

  const render = () => {
    if (!state) return;
    const st = state;
    const tutorialLeft = st.tutorial.some((x) => !x.claimed);
    if (tab === null) tab = tutorialLeft ? 'tutorial' : 'daily';
    const tabBtn = (k: Tab, label: string) =>
      h(
        'button',
        {
          class: `btn${tab === k ? ' primary' : ''}`,
          onclick: () => {
            tab = k;
            msg.textContent = '';
            render();
          },
        },
        label,
      );
    const items: HTMLElement[] = [
      h(
        'div',
        { class: 'row', style: 'justify-content:flex-start;margin-bottom:8px' },
        tabBtn('tutorial', t('quest.tabTutorial')),
        tabBtn('daily', t('quest.tabDaily')),
        tabBtn('attendance', t('quest.tabAttendance')),
      ),
    ];

    if (tab === 'tutorial') {
      if (!tutorialLeft) items.push(h('div', { class: 'pro' }, t('quest.tutorialDone')));
      for (const q of st.tutorial) items.push(questRow(q, true));
    } else if (tab === 'daily') {
      items.push(
        h(
          'div',
          { class: 'muted cd', 'data-finish': st.resetAt },
          t('quest.reset', { t: fmtDuration((st.resetAt - now()) / 1000) }),
        ),
      );
      for (const q of st.daily) items.push(questRow(q));
      const allClaimed = st.daily.every((d) => d.claimed);
      const bonusBtn = h('button', { class: 'btn primary' }, t('common.claim'));
      (bonusBtn as HTMLButtonElement).disabled = !allClaimed || st.dailyBonus.claimed;
      bonusBtn.addEventListener(
        'click',
        () => void claim(() => api.claimQuest(serverId, 'daily_bonus')),
      );
      items.push(
        h(
          'div',
          {
            class: `build-card${st.dailyBonus.claimed ? ' locked' : ''}`,
            style: 'border-color:var(--gold)',
          },
          h(
            'div',
            { class: 'build-main' },
            h('strong', {}, t('quest.bonus')),
            h('div', { class: 'muted' }, t('quest.bonusHint')),
            h('div', { class: 'muted' }, rewardText(st.dailyBonus.reward)),
          ),
          st.dailyBonus.claimed ? h('span', { class: 'badge' }, t('quest.claimed')) : bonusBtn,
        ),
      );
    } else {
      const a = st.attendance;
      const claimBtn = h(
        'button',
        { class: 'btn primary' },
        a.canClaim ? t('quest.attendanceClaim') : t('quest.attendanceDone'),
      );
      (claimBtn as HTMLButtonElement).disabled = !a.canClaim;
      claimBtn.addEventListener('click', () => void claim(() => api.claimAttendance(serverId)));
      items.push(h('div', {}, t('quest.attendanceStreak', { n: a.streak })));
      const grid = h('div', { class: 'att-grid' });
      for (const r of a.rewards) {
        const claimedDay = a.claimedToday
          ? r.day <= ((a.streak - 1) % a.rewards.length) + 1
          : r.day < a.nextDay;
        const isNext = !a.claimedToday && r.day === a.nextDay;
        grid.append(
          h(
            'div',
            { class: `att-cell${claimedDay ? ' done' : ''}${isNext ? ' next' : ''}` },
            ctx.manifest['events/attendance_card']
              ? h(
                  'div',
                  {
                    class: 'att-day',
                    style: `background-image:url(/${ctx.manifest[r.day === a.rewards.length ? 'events/attendance_card_day7' : 'events/attendance_card']})`,
                  },
                  t('quest.dayN', { n: r.day }),
                )
              : h('div', { class: 'muted' }, t('quest.dayN', { n: r.day })),
            h('div', { style: 'font-size:12px' }, rewardText(r.reward)),
          ),
        );
      }
      items.push(grid, h('div', { style: 'height:8px' }), claimBtn);
    }
    body.replaceChildren(...items, msg, err);
  };

  openModal(t('quest.heading'), body, () => clearInterval(timer), true);
  void api
    .quests(serverId)
    .then((q) => {
      apply(q);
      render();
    })
    .catch((e) => {
      err.textContent = errMsg(e);
      body.replaceChildren(err);
    });
  timer = window.setInterval(() => {
    body.querySelectorAll<HTMLElement>('.cd').forEach((el) => {
      el.textContent = t('quest.reset', {
        t: fmtDuration((Number(el.dataset.finish) - now()) / 1000),
      });
    });
  }, 1000);
}
