/**
 * 소리: 영지 배경음악(반복), 전투 연출 음악(단발), 효과음.
 * 브라우저는 사용자 조작 전에는 소리를 막으므로, 막히면 다음 클릭/터치 때 다시 시도한다.
 * 파일은 assets/audio/ (tools/import_audio.py 로 sound/ 에서 가져옴).
 */

const FILES = {
  bgm: '/audio/bgm_territory.mp3',
  battle: '/audio/bgm_battle_short.mp3',
  upgrade: '/audio/sfx_building_upgrade.mp3',
} as const;

const BGM_VOLUME = 0.45;
const BATTLE_VOLUME = 0.85;
const SFX_VOLUME = 0.9;
const STORE_KEY = 'sound_on';

let enabled = true;
try {
  enabled = localStorage.getItem(STORE_KEY) !== '0';
} catch {
  /* 저장소를 못 쓰면 기본값(켜짐) */
}

let bgm: HTMLAudioElement | null = null;
let battle: HTMLAudioElement | null = null;
let bgmWanted = false; // 영지 화면에 있어서 배경음악이 나와야 하는 상태
let battleActive = false;
let fadeTimer = 0;
const listeners = new Set<() => void>();
export const onSoundChange = (fn: () => void): void => void listeners.add(fn);

const make = (src: string, volume: number, loop = false): HTMLAudioElement => {
  const a = new Audio(src);
  a.preload = 'auto';
  a.volume = volume;
  a.loop = loop;
  return a;
};

function syncBgm(): void {
  if (!bgmWanted || !enabled || battleActive || document.hidden) {
    bgm?.pause();
    return;
  }
  bgm ??= make(FILES.bgm, BGM_VOLUME, true);
  // 자동재생이 막혀 있으면 다음 조작 때 다시 시도
  bgm.play().catch(() => {
    const retry = (): void => {
      window.removeEventListener('pointerdown', retry);
      syncBgm();
    };
    window.addEventListener('pointerdown', retry, { once: true });
  });
}

document.addEventListener('visibilitychange', syncBgm);

export const soundEnabled = (): boolean => enabled;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORE_KEY, on ? '1' : '0');
  } catch {
    /* 무시 */
  }
  if (!on) {
    battle?.pause();
    battleActive = false;
  }
  syncBgm();
  listeners.forEach((f) => f());
}

/** 영지 화면 진입: 배경음악 시작 */
export function startBgm(): void {
  bgmWanted = true;
  syncBgm();
}

export function stopBgm(): void {
  bgmWanted = false;
  syncBgm();
}

/** 전투 연출 시작: 배경음악을 멈추고 전투 음악을 재생한다 */
export function playBattle(): void {
  if (!enabled) return;
  battleActive = true;
  syncBgm();
  battle ??= make(FILES.battle, BATTLE_VOLUME);
  battle.currentTime = 0;
  battle.onended = stopBattle;
  void battle.play().catch(() => undefined);
}

/** 전투 연출 끝/건너뛰기/창 닫기: 전투 음악을 부드럽게 줄이고 배경음악을 이어 간다 */
export function stopBattle(): void {
  if (!battleActive) return;
  battleActive = false;
  const b = battle;
  if (b && !b.paused) {
    clearInterval(fadeTimer);
    fadeTimer = window.setInterval(() => {
      b.volume = Math.max(0, b.volume - 0.15);
      if (b.volume <= 0) {
        clearInterval(fadeTimer);
        b.pause();
        b.volume = BATTLE_VOLUME;
      }
    }, 40);
  }
  syncBgm();
}

/** 효과음 (겹쳐 재생될 수 있도록 매번 새로 만든다) */
export function playSfx(name: 'upgrade'): void {
  if (!enabled) return;
  const a = make(FILES[name], SFX_VOLUME);
  void a.play().catch(() => undefined);
}
