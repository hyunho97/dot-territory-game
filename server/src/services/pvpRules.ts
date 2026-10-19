/** PvP 규칙의 순수 계산 (DB/시간 비의존) */

export interface PvpRuleConfig {
  cpRangeMin: number;
  cpRangeMax: number;
  plunderRatio: number;
}

/** 상대 총 전투력이 내 전투력의 [min, max] 배 범위 안인지 */
export function isInCpRange(myCP: number, targetCP: number, cfg: PvpRuleConfig): boolean {
  if (myCP <= 0) return false;
  return targetCP >= myCP * cfg.cpRangeMin - 1e-9 && targetCP <= myCP * cfg.cpRangeMax + 1e-9;
}

/** 보호 종료 시각: 명시된 값이 없으면 생성 시각 + 보호 기간 */
export function protectionEnd(
  createdAt: number,
  protectionUntil: number | null,
  protectionHours: number,
): number {
  return protectionUntil ?? createdAt + protectionHours * 3_600_000;
}

/** 약탈량: (보유량 - 보호량) 의 ratio, 정수 내림. 보호량 이하면 0 */
export function calcPlunder(
  resources: Record<string, number>,
  protectedAmount: number,
  ratio: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(resources)) {
    const amount = Math.floor(Math.max(0, v - protectedAmount) * ratio);
    if (amount > 0) out[k] = amount;
  }
  return out;
}
