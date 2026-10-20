import webpush from 'web-push';
import { db } from '../db/db.js';
import { GameError } from './territoryService.js';
import { buildMessages } from './pushRules.js';
import type { PushEvent, PushKind, PushMessage } from './pushRules.js';

/** 웹 푸시 (건설/연구/모집/제작/탐험 완료 알림). VAPID 키는 처음 한 번 만들어 DB 에 저장한다. */

function kvGet(key: string): string | null {
  const r = db.prepare('SELECT value FROM app_kv WHERE key = ?').get(key) as
    { value: string } | undefined;
  return r?.value ?? null;
}
function kvSet(key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

let vapidReady = false;
export function vapidPublicKey(): string {
  let pub = kvGet('vapid_public');
  let priv = kvGet('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    kvSet('vapid_public', pub);
    kvSet('vapid_private', priv);
  }
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost.invalid',
      pub,
      priv,
    );
    vapidReady = true;
  }
  return pub;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscribe(userId: number, sub: unknown): void {
  const s = sub as Partial<SubscriptionInput> | null;
  if (
    !s ||
    typeof s.endpoint !== 'string' ||
    !/^https:\/\//.test(s.endpoint) ||
    s.endpoint.length > 1000 ||
    typeof s.keys?.p256dh !== 'string' ||
    typeof s.keys?.auth !== 'string' ||
    s.keys.p256dh.length > 200 ||
    s.keys.auth.length > 100
  )
    throw new GameError('INVALID_SUBSCRIPTION');
  // 한 사용자당 기기 5개까지 (오래된 것부터 정리)
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(s.endpoint, userId, s.keys.p256dh, s.keys.auth, Date.now());
  db.prepare(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint NOT IN
       (SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5)`,
  ).run(userId, userId);
}

export function unsubscribe(userId: number, endpoint: unknown): void {
  if (typeof endpoint !== 'string') throw new GameError('INVALID_SUBSCRIPTION');
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(
    userId,
    endpoint,
  );
}

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<void>;

const realSender: PushSender = async (sub, payload) => {
  vapidPublicKey();
  await webpush.sendNotification(sub, payload, { TTL: 3600 });
};

async function deliver(userId: number, msg: PushMessage, sender: PushSender): Promise<number> {
  const subs = db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId) as { endpoint: string; p256dh: string; auth: string }[];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ ...msg, url: '/' }),
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410)
          // 만료된 구독 정리
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
      }
    }),
  );
  return sent;
}

/** 내 기기로 시험 알림 */
export async function sendTest(userId: number, sender: PushSender = realSender): Promise<number> {
  return deliver(
    userId,
    { title: '도트 영지 경영', body: '알림이 정상적으로 켜졌습니다.', tag: 'test' },
    sender,
  );
}

/** (from, to] 구간에 끝난 타이머를 찾는다. 구독자가 있는 사용자만 대상. */
const SOURCES: [PushKind, string][] = [
  [
    'build',
    'SELECT c.user_id AS u FROM buildings x JOIN characters c ON c.id = x.character_id WHERE x.upgrade_finish_at > ? AND x.upgrade_finish_at <= ?',
  ],
  [
    'upgrade',
    'SELECT c.user_id AS u FROM buildings x JOIN characters c ON c.id = x.character_id WHERE x.levelup_finish_at > ? AND x.levelup_finish_at <= ?',
  ],
  [
    'levelup',
    'SELECT c.user_id AS u FROM characters c WHERE c.upgrade_finish_at > ? AND c.upgrade_finish_at <= ?',
  ],
  [
    'research',
    'SELECT c.user_id AS u FROM research_job x JOIN characters c ON c.id = x.character_id WHERE x.finish_at > ? AND x.finish_at <= ?',
  ],
  [
    'train',
    'SELECT c.user_id AS u FROM train_queue x JOIN characters c ON c.id = x.character_id WHERE x.collected = 0 AND x.finish_at > ? AND x.finish_at <= ?',
  ],
  [
    'craft',
    'SELECT c.user_id AS u FROM craft_queue x JOIN characters c ON c.id = x.character_id WHERE x.collected = 0 AND x.finish_at > ? AND x.finish_at <= ?',
  ],
  [
    'expedition',
    'SELECT c.user_id AS u FROM expeditions x JOIN characters c ON c.id = x.character_id WHERE x.collected = 0 AND x.finish_at > ? AND x.finish_at <= ?',
  ],
];

export function collectEvents(from: number, to: number): PushEvent[] {
  const events: PushEvent[] = [];
  const subscribed = new Set(
    (
      db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all() as { user_id: number }[]
    ).map((r) => r.user_id),
  );
  if (subscribed.size === 0) return events;
  for (const [kind, sql] of SOURCES) {
    const rows = db.prepare(sql).all(from, to) as { u: number }[];
    for (const r of rows) if (subscribed.has(r.u)) events.push({ userId: r.u, kind });
  }
  return events;
}

/** 한 번의 정기 점검: 지난 점검 이후 끝난 일을 알린다. 보낸 알림 수를 돌려준다. */
export async function sweep(
  from: number,
  to: number,
  sender: PushSender = realSender,
): Promise<number> {
  const msgs = buildMessages(collectEvents(from, to));
  let sent = 0;
  for (const [userId, msg] of msgs) sent += await deliver(userId, msg, sender);
  return sent;
}

export function startPushLoop(intervalMs = 20_000): void {
  let last = Number(kvGet('push_last') ?? Date.now());
  if (Date.now() - last > 15 * 60_000) last = Date.now(); // 오래 꺼져 있었다면 옛 알림은 버린다
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    const to = Date.now();
    sweep(last, to)
      .then(() => {
        last = to;
        kvSet('push_last', String(to));
      })
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, intervalMs).unref();
}
