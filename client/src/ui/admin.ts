import { api } from '../api/client';
import { t } from '../i18n';
import { h } from './dom';
import { errMsg, openModal } from './panels';
import type { PanelCtx } from './panels';

/** 테스트용 관리자 도구. 서버가 is_admin 계정만 허용한다. */
export function openAdminPanel(ctx: PanelCtx): void {
  const serverId = ctx.getChar().serverId;
  const msg = h('div', { class: 'pro' });
  const err = h('div', { class: 'error' });

  const run = async (action: string, value?: number) => {
    msg.textContent = '';
    err.textContent = '';
    try {
      await api.adminAction(serverId, action, value);
      await ctx.refresh();
      msg.textContent = t('admin.done');
    } catch (e) {
      err.textContent = errMsg(e);
    }
  };
  const btn = (label: string, action: string, value?: number): HTMLElement =>
    h('button', { class: 'btn primary', onclick: () => void run(action, value) }, label);

  const level = h('input', {
    type: 'number',
    min: '1',
    max: '10',
    value: String(ctx.getChar().territoryLevel),
    style: 'width:70px',
  }) as HTMLInputElement;

  const body = h(
    'div',
    { class: 'modal-body' },
    h('div', { class: 'muted' }, t('admin.hint')),
    h(
      'div',
      { class: 'build-row-list' },
      btn(t('admin.resources'), 'resources'),
      btn(t('admin.speedup'), 'speedup'),
      btn(t('admin.finishAll'), 'finishAll'),
      btn(t('admin.fillTroops'), 'fillTroops'),
      btn(t('admin.resetDaily'), 'resetDaily'),
      h(
        'div',
        { class: 'row', style: 'justify-content:flex-start;gap:8px' },
        h('span', {}, t('admin.setLevel')),
        level,
        h(
          'button',
          { class: 'btn primary', onclick: () => void run('setLevel', Number(level.value)) },
          t('admin.apply'),
        ),
      ),
    ),
    msg,
    err,
  );
  openModal(t('admin.heading'), body, () => undefined);
}
