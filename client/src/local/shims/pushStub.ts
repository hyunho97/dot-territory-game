/** 혼자 하는 웹판에는 서버가 없으므로 푸시 알림 서비스를 비운다. */
export function vapidPublicKey(): string {
  return '';
}
export function subscribe(): void {}
export function unsubscribe(): void {}
export async function sendTest(): Promise<number> {
  return 0;
}
export function startPushLoop(): void {}
