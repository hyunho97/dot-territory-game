/**
 * 푸시 알림 점검 (임시 DB 사용, 실제 전송 없음): 구독 → 타이머 완료 구간 점검 → 만료 구독 정리.
 * 실행: node --import tsx tools/push_check.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'pushchk-')), 'test.db');
const { db } = await import('../server/src/db/db.js');
const push = await import('../server/src/services/pushService.js');

const ok = (n: string, c: boolean) => console.log(`${c ? 'PASS' : 'FAIL'} ${n}`);
const now = Date.now();
db.prepare("INSERT OR IGNORE INTO servers (id, name, created_at) VALUES (1, 's', ?)").run(now);
const mkUser = (n: string) =>
  Number(
    db
      .prepare('INSERT INTO users (nickname, token, created_at) VALUES (?,?,?)')
      .run(n, n + 'tok', now).lastInsertRowid,
  );
const u1 = mkUser('a');
const u2 = mkUser('b');
const mkChar = (u: number, s: number) =>
  Number(
    db
      .prepare(
        'INSERT INTO characters (user_id, server_id, race, territory_name, territory_level, created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(u, s, 'human', 'x' + u, 1, now).lastInsertRowid,
  );
db.prepare("INSERT OR IGNORE INTO servers (id, name, created_at) VALUES (2, 's2', ?)").run(now);
const c1 = mkChar(u1, 1);
const c2 = mkChar(u2, 1);

const sub = (e: string) => ({ endpoint: `https://push.example/${e}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });
push.subscribe(u1, sub('one'));
ok('invalid endpoint rejected', (() => { try { push.subscribe(u1, { endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } }); return false; } catch { return true; } })());
ok('vapid key generated', push.vapidPublicKey().length > 40);

// u1 만 구독. 두 사용자 모두 건물 건설이 끝남 → u1 만 알림
db.prepare("INSERT INTO buildings (character_id, type, level, upgrade_finish_at, position_x, position_y) VALUES (?, 'farm', 1, ?, 0, 0)").run(c1, now - 5_000);
db.prepare("INSERT INTO buildings (character_id, type, level, upgrade_finish_at, position_x, position_y) VALUES (?, 'farm', 1, ?, 0, 0)").run(c2, now - 5_000);
db.prepare("INSERT INTO train_queue (character_id, unit_id, amount, start_at, finish_at) VALUES (?, 'militia', 1, ?, ?)").run(c1, now - 9_000, now - 4_000);
const sent: { endpoint: string; body: string }[] = [];
const sender = async (s: { endpoint: string }, payload: string) => {
  sent.push({ endpoint: s.endpoint, body: JSON.parse(payload).body });
};
let n = await push.sweep(now - 60_000, now, sender);
ok('only subscribed user notified (1 message, combined)', n === 1 && sent.length === 1 && /외 1건/.test(sent[0].body));
// 같은 구간을 다시 점검해도 새 구간이 아니면 이벤트가 없다 (구간이 겹치지 않는 운영 방식)
sent.length = 0;
n = await push.sweep(now, now + 1_000, sender);
ok('no events in later window', n === 0);
// 아직 끝나지 않은 타이머는 알리지 않는다
db.prepare("INSERT INTO research_job (character_id, tech_id, to_level, finish_at) VALUES (?, 'x', 1, ?)").run(c1, now + 600_000);
n = await push.sweep(now - 60_000, now + 1_000, sender);
ok('unfinished timer not notified', sent.every((x) => !/연구/.test(x.body)));
// 만료된 구독(410) 정리
sent.length = 0;
const gone = async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); };
await push.sweep(now - 60_000, now, gone);
const left = (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(u1) as { n: number }).n;
ok('expired subscription removed', left === 0);
// 기기 5개 제한
for (let i = 0; i < 7; i++) push.subscribe(u2, sub('d' + i));
const cnt = (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(u2) as { n: number }).n;
ok('max 5 devices per user', cnt === 5);
