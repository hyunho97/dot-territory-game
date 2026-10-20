declare module 'virtual:local-boot' {
  export const LOCAL: boolean;
  export function openSaveManager(): void;
  export function bootLocal(): Promise<boolean>;
}
