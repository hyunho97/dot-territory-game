import { t } from '../i18n';
import { h } from '../ui/dom';
import { openModal } from '../ui/panels';
import { clearSave, writeSave } from './saveStore';
import { currentDb } from './shims/sqlite';

/** 저장 관리: 파일로 내보내기 / 파일에서 불러오기 / 처음부터 다시 시작 */
export function openSaveManager(): void {
  const msg = h('div', { class: 'pro' });
  const err = h('div', { class: 'error' });

  const doExport = (): void => {
    const db = currentDb();
    if (!db) return;
    const blob = new Blob([db.export() as BlobPart], { type: 'application/octet-stream' });
    const a = h('a', {
      href: URL.createObjectURL(blob),
      download: `dot-territory-save-${new Date().toISOString().slice(0, 10)}.sqlite`,
    }) as HTMLAnchorElement;
    document.body.append(a);
    a.click();
    a.remove();
    msg.textContent = t('save.exported');
  };

  const fileInput = h('input', {
    type: 'file',
    accept: '.sqlite,.db',
    style: 'display:none',
  }) as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    err.textContent = '';
    const bytes = new Uint8Array(await f.arrayBuffer());
    // SQLite 파일 머리말 확인
    const head = new TextDecoder().decode(bytes.slice(0, 15));
    if (head !== 'SQLite format 3') {
      err.textContent = t('save.invalid');
      return;
    }
    await writeSave(bytes);
    location.reload();
  });

  const doReset = async (): Promise<void> => {
    if (!confirm(t('save.resetConfirm'))) return;
    await clearSave();
    location.reload();
  };

  const body = h(
    'div',
    { class: 'modal-body' },
    h('p', { class: 'muted' }, t('save.hint')),
    h(
      'div',
      { class: 'build-row-list' },
      h('button', { class: 'btn primary', onclick: doExport }, t('save.export')),
      h('button', { class: 'btn primary', onclick: () => fileInput.click() }, t('save.import')),
      h('button', { class: 'btn', onclick: () => void doReset() }, t('save.reset')),
    ),
    fileInput,
    msg,
    err,
  );
  openModal(t('save.heading'), body, () => undefined);
}
