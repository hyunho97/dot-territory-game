import { api } from './api/client';

/** PWA(홈 화면 설치) + 웹 푸시 알림 도우미 */

let installEvent: (Event & { prompt: () => Promise<void> }) | null = null;
const listeners = new Set<() => void>();
export const onPwaChange = (fn: () => void): void => void listeners.add(fn);
const notify = (): void => listeners.forEach((f) => f());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as typeof installEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  notify();
});

export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;
export const isIOS = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function canInstall(): boolean {
  return installEvent !== null;
}
export async function promptInstall(): Promise<void> {
  if (!installEvent) return;
  await installEvent.prompt();
  installEvent = null;
  notify();
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  return (await currentSubscription()) !== null;
}

function keyToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushResult = 'ok' | 'denied' | 'unsupported';

/** 알림 권한을 요청하고 이 기기를 서버에 등록한다 */
export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg =
    (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker());
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api.pushKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(key) as BufferSource,
    });
  }
  await api.pushSubscribe(sub.toJSON());
  return 'ok';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
