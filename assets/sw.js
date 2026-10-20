/* 서비스 워커: 웹 푸시 알림 + 정적 이미지 캐시(오프라인 대비 / 재방문 속도). API 응답은 절대 캐시하지 않는다. */
const CACHE = 'dot-territory-v1';
// 사이트가 하위 경로(예: GitHub Pages)에 있어도 맞도록 서비스 워커의 범위를 기준으로 경로를 만든다
const BASE = new URL('./', self.registration.scope).pathname;
const STATIC_PREFIXES = ['sprites/', 'territory/', 'races/', 'icons/', 'audio/'].map((p) => BASE + p);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  // 이미지: 캐시 우선 + 백그라운드 갱신
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});

self.addEventListener('push', (e) => {
  let data = { title: '도트 영지 경영', body: '', tag: 'info', url: BASE };
  try {
    data = { ...data, ...e.data.json() };
  } catch {
    /* 본문이 JSON 이 아니면 기본 문구 */
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: BASE + 'icons/pwa-192.png',
      badge: BASE + 'icons/badge-96.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || BASE;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
