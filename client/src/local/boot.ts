/**
 * 혼자 하는 웹판 시작 코드: SQLite(WASM) 준비 → 저장 불러오기 → 서버 라우트 등록 → 로컬 계정/세션 자동 생성.
 * (이 파일은 로컬 빌드에서만 번들에 들어간다)
 */
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { setLocalHandler, session } from '../api/client';
import { currentDb, setSqlJs } from './shims/sqlite';
import { LocalApp } from './localApp';
import { loadSave, writeSave } from './saveStore';

export const LOCAL = true;
export { openSaveManager } from './saveManager';

const LOCAL_TOKEN = 'local-session';

export async function bootLocal(): Promise<boolean> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const bytes = await loadSave();
  setSqlJs(SQL, bytes, (db) => void writeSave(db.export()));

  // 서버 모듈은 DB 가 준비된 뒤에 불러온다 (db.ts 가 불러오는 즉시 DB 를 연다)
  const { registerRoutes } = await import('../../../server/src/routes/index.js');
  const { db } = await import('../../../server/src/db/db.js');
  const { ensureNpcWorld } = await import('../../../server/src/services/npcService.js');

  const app = new LocalApp();
  registerRoutes(app as never);

  // 로컬 계정 + 세션 (비밀번호 없음)
  const now = Date.now();
  let user = db.prepare("SELECT id FROM users WHERE login_id = 'local'").get() as
    { id: number } | undefined;
  if (!user) {
    const r = db
      .prepare(
        "INSERT INTO users (nickname, token, login_id, pw_hash, pw_salt, created_at) VALUES ('영주', 'local-user', 'local', 'x', 'x', ?)",
      )
      .run(now);
    user = { id: Number(r.lastInsertRowid) };
  }
  db.prepare(
    'INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)',
  ).run(LOCAL_TOKEN, user.id, now, now + 3650 * 86_400_000);
  // 주소 끝에 #admin 이 있으면 관리자 도구(치트)를 켠다
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(
    location.hash.includes('admin') ? 1 : 0,
    user.id,
  );
  ensureNpcWorld(now);
  session.set(LOCAL_TOKEN, '영주', 'local');

  setLocalHandler((method, url, body) =>
    app.handle(method, url, body, { authorization: `Bearer ${LOCAL_TOKEN}` }),
  );
  // 창을 닫기 직전에도 저장
  const flush = (): void => {
    const raw = currentDb();
    if (raw) void writeSave(raw.export());
  };
  window.addEventListener('pagehide', flush);
  return true;
}
