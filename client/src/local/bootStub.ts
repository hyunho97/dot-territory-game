/** 온라인(서버 연결) 빌드에서는 로컬 부팅 코드가 번들에 들어가지 않는다. */
export const LOCAL = false;
export function openSaveManager(): void {}
export async function bootLocal(): Promise<boolean> {
  return false;
}
