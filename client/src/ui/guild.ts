import { api } from '../api/client';
import type { GuildListItem, GuildState } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { guildBossSection } from './guildBoss';
import { RES_COLORS, costEl, errMsg, openModal } from './panels';
import type { PanelCtx } from './panels';

const RES = ['food', 'wood', 'stone', 'iron', 'gold'];
const pct = (v: number): string => `+${(v * 100).toFixed(1).replace(/\.0$/, '')}%`;

export function openGuildPanel(ctx: PanelCtx): void {
  const serverId = ctx.getChar().serverId;
  const body = h('div', { class: 'modal-body' });
  const err = h('div', { class: 'error' });
  const msg = h('div', { class: 'pro' });
  let state: GuildState | null = null;
  let list: GuildListItem[] = [];

  /** 서버 호출 공통 처리: 성공하면 새 상태로 다시 그리고, 실패하면 오류만 보여 준다 */
  const act = async (fn: () => Promise<GuildState | { guild: GuildState }>, ok?: string) => {
    err.textContent = '';
    msg.textContent = '';
    try {
      const r = await fn();
      // 기부 응답은 { result, guild: 상태 } 형태, 나머지는 상태 자체
      state = 'serverNow' in r ? r : r.guild;
      if (ok) msg.textContent = ok;
      if (!state.guild) list = await api.guildList(serverId);
      await ctx.refresh();
    } catch (e) {
      err.textContent = errMsg(e);
    }
    render();
  };

  const renderNoGuild = (st: GuildState): HTMLElement[] => {
    const nameInput = h('input', {
      class: 'input',
      maxlength: st.nameLength.max,
      placeholder: t('guild.namePlaceholder', st.nameLength),
    }) as HTMLInputElement;
    const create = h('button', { class: 'btn primary' }, t('guild.create'));
    create.addEventListener(
      'click',
      () => void act(() => api.guildCreate(serverId, nameInput.value)),
    );
    const rows = list.length
      ? list.map((g) => {
          const join = h('button', { class: 'btn primary' }, t('guild.join'));
          (join as HTMLButtonElement).disabled = g.members >= g.maxMembers;
          join.addEventListener('click', () => void act(() => api.guildJoin(serverId, g.id)));
          return h(
            'div',
            { class: 'build-row' },
            h(
              'span',
              {},
              h('strong', {}, g.name),
              h(
                'span',
                { class: 'muted' },
                `  Lv.${g.level} · ${t('guild.leader', { name: g.leader })} · ${g.members}/${g.maxMembers}`,
              ),
            ),
            join,
          );
        })
      : [h('div', { class: 'muted' }, t('guild.noneYet'))];
    return [
      h('h3', {}, t('guild.createHeading')),
      h(
        'div',
        { class: 'row', style: 'justify-content:flex-start;gap:8px;flex-wrap:wrap' },
        nameInput,
        create,
        h(
          'span',
          {},
          `${t('buildPanel.cost')}: `,
          costEl(st.createCost, ctx.getChar().resources, 1),
        ),
      ),
      h('h3', { style: 'margin-top:12px' }, t('guild.listHeading')),
      ...rows,
    ];
  };

  const renderGuild = (st: GuildState): HTMLElement[] => {
    const g = st.guild!;
    const out: HTMLElement[] = [];
    out.push(
      h(
        'div',
        { class: 'build-card levelup' },
        h(
          'div',
          { class: 'build-main' },
          h('h3', { style: 'margin:0;color:var(--gold)' }, `${g.name}  Lv.${g.level}`),
          h(
            'div',
            { class: 'muted' },
            g.nextExp === null
              ? t('guild.expMax', { exp: g.exp })
              : t('guild.exp', { exp: g.exp, next: g.nextExp }),
          ),
          h(
            'div',
            { class: 'pro' },
            t('guild.buff', { prod: pct(g.buff.production), combat: pct(g.buff.combat) }),
            h(
              'span',
              { class: 'muted' },
              `  ${t('guild.members', { n: g.memberCount, max: g.maxMembers })}`,
            ),
          ),
        ),
      ),
    );

    out.push(guildBossSection(ctx));

    // 공지
    const notice = h('div', { class: 'muted' });
    notice.textContent = g.notice || t('guild.noNotice'); // textContent: 사용자 입력이라 HTML 로 해석하지 않는다
    out.push(h('h3', { style: 'margin-top:10px' }, t('guild.notice')), notice);
    if (g.isLeader) {
      const input = h('input', {
        class: 'input',
        maxlength: st.noticeMaxLength,
        value: g.notice,
      }) as HTMLInputElement;
      const save = h('button', { class: 'btn' }, t('guild.noticeSave'));
      save.addEventListener('click', () => void act(() => api.guildNotice(serverId, input.value)));
      out.push(
        h('div', { class: 'row', style: 'justify-content:flex-start;gap:8px' }, input, save),
      );
    }

    // 기부
    const resSel = h(
      'select',
      { class: 'input' },
      ...RES.map((r) => h('option', { value: r }, t(`resource.${r}`))),
    ) as HTMLSelectElement;
    const amount = h('input', {
      class: 'input',
      type: 'number',
      min: 1,
      value: 100,
    }) as HTMLInputElement;
    const exp = h('span', { class: 'muted' });
    const calc = () => {
      const v = Number(amount.value) * (st.donate.values[resSel.value] ?? 0);
      exp.textContent = t('guild.donateExp', { n: Math.floor(v * st.donate.expPerValue) });
    };
    resSel.addEventListener('change', calc);
    amount.addEventListener('input', calc);
    calc();
    const donateBtn = h('button', { class: 'btn primary' }, t('guild.donate'));
    donateBtn.addEventListener(
      'click',
      () =>
        void act(
          () => api.guildDonate(serverId, resSel.value, Math.floor(Number(amount.value))),
          t('guild.donated'),
        ),
    );
    out.push(
      h('h3', { style: 'margin-top:10px' }, t('guild.donateHeading')),
      h(
        'div',
        { class: 'muted' },
        t('guild.donateLimit', { used: st.donate.used, limit: st.donate.limit }),
      ),
      h(
        'div',
        { class: 'row', style: 'justify-content:flex-start;gap:8px;flex-wrap:wrap' },
        resSel,
        amount,
        donateBtn,
        exp,
      ),
    );

    // 멤버
    out.push(h('h3', { style: 'margin-top:10px' }, t('guild.memberHeading')));
    const myId = ctx.getChar().id;
    for (const m of g.members) {
      const actions: HTMLElement[] = [];
      if (g.isLeader && m.characterId !== myId) {
        const kick = h('button', { class: 'btn' }, t('guild.kick'));
        kick.addEventListener('click', () => {
          if (confirm(t('guild.confirmKick', { name: m.owner })))
            void act(() => api.guildKick(serverId, m.characterId));
        });
        const give = h('button', { class: 'btn' }, t('guild.transfer'));
        give.addEventListener('click', () => {
          if (confirm(t('guild.confirmTransfer', { name: m.owner })))
            void act(() => api.guildTransfer(serverId, m.characterId));
        });
        actions.push(give, kick);
      }
      out.push(
        h(
          'div',
          { class: 'build-row', style: m.characterId === myId ? 'border-color:var(--gold)' : '' },
          h(
            'span',
            {},
            h('strong', {}, `${m.isLeader ? '👑 ' : ''}${m.owner}`),
            h(
              'span',
              { class: 'muted' },
              `  ${m.territoryName} · ${t('territory.level', { n: m.level })}`,
            ),
          ),
          h(
            'span',
            { class: 'row' },
            h(
              'span',
              { style: `color:${RES_COLORS.gold}` },
              t('guild.contribution', { n: m.contribution }),
            ),
            ...actions,
          ),
        ),
      );
    }

    // 탈퇴/해산
    const leave = h(
      'button',
      { class: 'btn' },
      g.isLeader && g.memberCount === 1 ? t('guild.leaveDisband') : t('guild.leave'),
    );
    leave.addEventListener('click', () => {
      if (confirm(t('guild.confirmLeave'))) void act(() => api.guildLeave(serverId));
    });
    const row = h('div', { class: 'row', style: 'margin-top:12px;gap:8px' }, leave);
    if (g.isLeader && g.memberCount > 1) {
      const dis = h('button', { class: 'btn' }, t('guild.disband'));
      dis.addEventListener('click', () => {
        if (confirm(t('guild.confirmDisband'))) void act(() => api.guildDisband(serverId));
      });
      row.append(dis);
    }
    out.push(row);
    return out;
  };

  const render = () => {
    if (!state) return;
    if (state.locked) {
      body.replaceChildren(h('div', { class: 'error' }, t('guild.locked', { n: state.minLevel })));
      return;
    }
    body.replaceChildren(...(state.guild ? renderGuild(state) : renderNoGuild(state)), msg, err);
  };

  openModal(t('guild.heading'), body, () => undefined, true);
  body.replaceChildren(h('div', { class: 'muted' }, t('common.loading')));
  void Promise.all([api.guild(serverId), api.guildList(serverId)])
    .then(([s, l]) => {
      state = s;
      list = l;
      render();
    })
    .catch((e) => body.replaceChildren(h('div', { class: 'error' }, errMsg(e))));
}
