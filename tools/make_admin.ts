/**
 * 테스트용 관리자 계정을 만들거나 기존 계정을 관리자로 올린다.
 * 사용법: node --import tsx tools/make_admin.ts <loginId> [password]
 *   - 계정이 없으면 password(8자 이상)로 새로 만든다. 있으면 관리자 권한만 켠다 (비밀번호는 그대로).
 *   - 해제: node --import tsx tools/make_admin.ts <loginId> --off
 * DB 파일은 서버와 같은 규칙(DB_PATH)을 따른다. 서버를 켜 둔 채 실행해도 된다.
 * 관리자 권한은 이 스크립트(DB 직접 접근)로만 줄 수 있고, 웹/API 로는 줄 수 없다.
 */
import { randomBytes } from 'node:crypto';
import { db } from '../server/src/db/db.js';
import { hashPassword, normalizeLoginId, validPassword } from '../server/src/services/authRules.js';

const [rawId, arg] = process.argv.slice(2);
const loginId = normalizeLoginId(rawId);
if (!loginId) {
  console.error('사용법: make_admin.ts <loginId(영문소문자·숫자·_ 4~20자)> [password | --off]');
  process.exit(1);
}
const user = db.prepare('SELECT id FROM users WHERE login_id = ?').get(loginId) as
  { id: number } | undefined;
if (arg === '--off') {
  if (!user) throw new Error('없는 계정입니다.');
  db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(user.id);
  console.log(`${loginId}: 관리자 해제`);
} else if (user) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  console.log(`${loginId}: 관리자 권한 부여`);
} else {
  if (!validPassword(arg)) {
    console.error('새 계정은 8자 이상 비밀번호가 필요합니다.');
    process.exit(1);
  }
  const { salt, hash } = hashPassword(arg);
  const nickname = `관리자_${loginId}`.slice(0, 12);
  db.prepare(
    'INSERT INTO users (nickname, token, login_id, pw_hash, pw_salt, is_admin, created_at) VALUES (?,?,?,?,?,1,?)',
  ).run(nickname, randomBytes(24).toString('hex'), loginId, hash, salt, Date.now());
  console.log(`${loginId}: 관리자 계정 생성 (닉네임 ${nickname})`);
}
