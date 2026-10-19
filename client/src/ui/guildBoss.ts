import { api } from '../api/client';
import type { GuildBossState } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { iconEl } from './icons';
import { errMsg, fmtDuration, once } from './panels';
import type { PanelCtx } from './panels';

const RATIOS = [0.25, 0.5, 1];

/** 길드 패널 안에 들어가는 보스 레이드 구역 (자체적으로 불러오고 다시 그린다) */
export function guildBossSection(ctx: PanelCtx): HTMLElement {
  const serverId = ctx.getChar().serverId;
  const root = h('div', { class: 'build-card', style: 'display:block;margin-top:10px' });
  const err = h('div', { class: 'error' });
  const msg = h('div', { class: 'pro' });
  let state: GuildBossState | null = null;
  let timer = 0;
  let loadedAt = Date.now(); // 서버 시각 기준 남은 시간 계산용

  const act = async (
    fn: () => Promise<GuildBossState | { state: GuildBossState; text?: string }>,
  ) => {
    err.textContent = '';
    msg.textContent = '';
    try {
      const r = await fn();
      if ('serverNow' in r) state = r;
      else {
        state = r.state;
        if (r.text) msg.textContent = r.text;
      }
      loadedAt = Date.now();
      await ctx.refresh().catch(() => undefined);
    } catch (e) {
      err.textContent = errMsg(e);
    }
    render();
  };

  /** 대기 병력의 비율만큼을 많이 가진 유닛부터 채워 출전 병력을 만든다 */
  const pick = (ratio: number): { units: Record<string, number>; cp: number; n: number } => {
    const ch = ctx.getChar();
    let left = Math.floor(ch.idleTroops * ratio);
    const units: Record<string, number> = {};
    let cp = 0;
    for (const u of [...ch.units].sort((a, b) => b.count - a.count)) {
      const take = Math.min(u.count, left);
      if (take <= 0) continue;
      units[u.unitId] = take;
      cp += take * (ch.unitCP[u.unitId] ?? 0);
      left -= take;
    }
    return { units, cp, n: Object.values(units).reduce((s, v) => s + v, 0) };
  };

  const render = () => {
    clearInterval(timer);
    if (!state) return;
    const st = state;
    const kids: (HTMLElement | string)[] = [
      h('h3', { style: 'margin:0;color:var(--gold)' }, t('boss.heading')),
    ];
    if (st.active) {
      const a = st.active;
      const pct = Math.max(0, Math.min(100, (a.hp / a.hpMax) * 100));
      const cd = h('span', { class: 'muted' });
      const tick = () => {
        cd.textContent = ` · ${t('boss.remaining', { t: fmtDuration((a.endsAt - (st.serverNow + (Date.now() - loadedAt))) / 1000) })}`;
      };
      tick();
      timer = window.setInterval(() => {
        if (!document.body.contains(root)) return clearInterval(timer);
        tick();
        if (a.endsAt <= st.serverNow + (Date.now() - loadedAt)) refreshOnce();
      }, 1000);
      kids.push(
        h(
          'div',
          { class: 'row', style: 'justify-content:flex-start;gap:10px' },
          iconEl(`boss/${a.tier}`, 96, ctx.manifest) ?? '',
          h('div', {}, h('strong', {}, t(`boss.name.${a.tier}`)), cd),
        ),
        h(
          'div',
          {
            style:
              'background:#0d0b16;border:2px solid var(--border);height:18px;margin:6px 0;position:relative',
          },
          h('div', { style: `background:#b3343c;height:100%;width:${pct}%` }),
          h(
            'div',
            {
              style: 'position:absolute;inset:0;text-align:center;font-size:12px;line-height:18px',
            },
            `${a.hp.toLocaleString()} / ${a.hpMax.toLocaleString()}`,
          ),
        ),
        h(
          'div',
          { class: 'muted' },
          t('boss.my', {
            dmg: a.myDamage.toLocaleString(),
            left: a.ticketsLeft,
            max: st.ticketsPerDay,
          }),
        ),
      );
      const row = h('div', {
        class: 'row',
        style: 'justify-content:flex-start;gap:8px;flex-wrap:wrap;margin-top:6px',
      });
      for (const ratio of RATIOS) {
        const p = pick(ratio);
        const btn = h(
          'button',
          { class: 'btn primary' },
          t('boss.attack', {
            pct: Math.round(ratio * 100),
            dmg: Math.round(p.cp).toLocaleString(),
          }),
        );
        (btn as HTMLButtonElement).disabled = p.n < 1 || a.ticketsLeft < 1;
        btn.addEventListener('click', () => {
          const sel = pick(ratio);
          void act(async () => {
            const r = await api.guildBossAttack(serverId, sel.units);
            return {
              state: r.state,
              text: r.killed
                ? t('boss.killed')
                : t('boss.hit', { dmg: r.damage.toLocaleString(), lost: r.lost }),
            };
          });
        });
        row.append(btn);
      }
      kids.push(
        row,
        h('div', { class: 'muted' }, t('boss.lossNote', { pct: Math.round(st.lossRatio * 100) })),
      );
      if (a.ranking.length) {
        kids.push(
          h('div', { class: 'muted', style: 'margin-top:6px' }, t('boss.ranking')),
          ...a.ranking.map((r, i) =>
            h(
              'div',
              { style: r.isMe ? 'color:var(--gold)' : '' },
              `${i + 1}. ${r.owner} — ${r.damage.toLocaleString()} (${r.attacks}${t('boss.times')})`,
            ),
          ),
        );
      }
    } else {
      if (st.last)
        kids.push(
          iconEl(
            st.last.won ? 'events/result_boss_win' : 'events/result_boss_lose',
            64,
            ctx.manifest,
          ) ?? '',
          h(
            'div',
            { class: st.last.won ? 'pro' : 'con' },
            st.last.won
              ? t('boss.lastWon', { name: t(`boss.name.${st.last.tier}`) })
              : t('boss.lastLost', { name: t(`boss.name.${st.last.tier}`) }),
          ),
        );
      if (st.isLeader) {
        const btn = h(
          'button',
          { class: 'btn primary' },
          t('boss.summon', { name: t(`boss.name.${st.summonTier}`) }),
        );
        (btn as HTMLButtonElement).disabled = !st.canSummon;
        btn.addEventListener('click', () => void act(() => api.guildBossSummon(serverId)));
        kids.push(btn);
        if (!st.canSummon && st.summonCooldownUntil > st.serverNow)
          kids.push(
            h(
              'div',
              { class: 'muted' },
              t('boss.cooldown', {
                t: fmtDuration((st.summonCooldownUntil - st.serverNow) / 1000),
              }),
            ),
          );
      } else kids.push(h('div', { class: 'muted' }, t('boss.waitLeader')));
      kids.push(h('div', { class: 'muted' }, t('boss.desc')));
    }
    root.replaceChildren(
      ...kids.map((k) => (typeof k === 'string' ? h('div', {}, k) : k)),
      msg,
      err,
    );
  };

  const load = () =>
    api.guildBoss(serverId).then((s) => {
      state = s;
      loadedAt = Date.now();
      render();
    });
  const refreshOnce = once(() => load().catch(() => undefined));
  root.append(h('div', { class: 'muted' }, t('common.loading')));
  load().catch((e) => root.replaceChildren(h('div', { class: 'error' }, errMsg(e))));
  return root;
}
