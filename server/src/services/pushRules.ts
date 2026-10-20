/** 푸시 알림 문구 규칙 (순수 함수) */

export type PushKind =
  'build' | 'upgrade' | 'levelup' | 'research' | 'train' | 'craft' | 'expedition';

export interface PushEvent {
  userId: number;
  kind: PushKind;
}

const TEXT: Record<PushKind, string> = {
  build: '건물 건설이 완료되었습니다',
  upgrade: '건물 업그레이드가 완료되었습니다',
  levelup: '영지 레벨업이 완료되었습니다',
  research: '연구가 완료되었습니다',
  train: '병사 모집이 완료되었습니다',
  craft: '장비 제작이 완료되었습니다',
  expedition: '탐험대가 돌아왔습니다',
};

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
}

/** 사용자별로 이번 구간에 끝난 일을 하나의 알림으로 묶는다 */
export function buildMessages(events: PushEvent[]): Map<number, PushMessage> {
  const byUser = new Map<number, PushKind[]>();
  for (const e of events) {
    const list = byUser.get(e.userId) ?? [];
    if (!list.includes(e.kind)) list.push(e.kind);
    byUser.set(e.userId, list);
  }
  const out = new Map<number, PushMessage>();
  for (const [userId, kinds] of byUser) {
    const body =
      kinds.length === 1
        ? TEXT[kinds[0]]
        : `${TEXT[kinds[0]]} 외 ${kinds.length - 1}건이 완료되었습니다`;
    out.set(userId, {
      title: '도트 영지 경영',
      body: kinds.length === 1 ? `${body}.` : `${body}.`,
      tag: kinds.length === 1 ? kinds[0] : 'multi',
    });
  }
  return out;
}
