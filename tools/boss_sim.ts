/**
 * 길드 보스 레이드 밸런스 시뮬레이터 — data/guild_boss.json 과 실제 규칙 함수(guildBossRules)를 그대로 쓴다.
 *
 * 사용법: node --import tsx tools/boss_sim.ts [--members 10] [--level 5] [--runs 2000] [--cp 4700]
 *   --members  길드원 수            --level  길드원 영지 레벨(군대 규모 가정 선택용)
 *   --cp       멤버 한 명의 보유 병력 전투력 (기본: 레벨별 대표값)
 * 가정: 참여율 p = 길드원 중 보스 기간 동안 실제로 공격하는 비율, 참여자는 하루 최대 2번 전 병력(대기 병력)으로 공격,
 *       공격마다 병력의 5% 손실(올림), 72시간 = 3일.
 * 출력: 참여율별 처치 확률 / 평균 처치 시간 / 참여자 1인당 보상 가치 대비 병력 손실 가치.
 */
import { createRng } from '../server/src/services/battle.js';
import { bossHp, rollDamage, tierFor } from '../server/src/services/guildBossRules.js';
import { guildBossData, marketData } from '../server/src/data.js';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const MEMBERS = Number(arg('members', '10'));
const RUNS = Number(arg('runs', '2000'));
// 영지 레벨별 대표 군대 전투력 (tools/dungeon_sim.ts 의 상위 2티어 최대 병력 군대, 배수 1.15)
const CP_BY_LEVEL: Record<number, number> = { 3: 1880, 5: 4738, 7: 16652, 10: 94208 };
const LEVEL = Number(arg('level', '5'));
const CP = Number(arg('cp', String(CP_BY_LEVEL[LEVEL] ?? 4738)));
const DAYS = guildBossData.durationHours / 24;
const val = marketData.values as Record<string, number>;
const value = (r: Record<string, number>) =>
  Object.entries(r).reduce((s, [k, v]) => s + v * val[k], 0);

/** 길드 레벨은 멤버 수와 무관하게 1(트롤)부터 시작한다고 보고 3개 등급을 모두 본다 */
const guildLevelsToCheck = [1, 4, 7];

console.log(
  `길드원 ${MEMBERS}명 · 멤버 전투력 ${CP} (영지 Lv.${LEVEL} 대표값) · 기간 ${DAYS}일 · 하루 ${guildBossData.ticketsPerDay}회 · 손실 ${guildBossData.lossRatio * 100}%`,
);
for (const gl of guildLevelsToCheck) {
  const tier = tierFor(gl);
  const hp = bossHp(MEMBERS * CP, tier);
  const rewardValue = value(tier.reward); // 가속은 가치 환산에서 제외
  console.log(
    `\n── 길드 Lv.${gl} 보스(${tier.id}) · 체력 ${hp.toLocaleString()} (하한 ${tier.hpFloor.toLocaleString()}) · 보상 가치 ${Math.round(rewardValue)} + 가속 ${tier.speedupMin}분 ──`,
  );
  console.log('참여율 | 처치 확률 | 평균 처치 시간(일) | 1인 평균 피해/체력 | 1인 손실(전투력 %) ');
  for (const p of [0.3, 0.4, 0.5, 0.6, 0.8, 1]) {
    let kills = 0;
    let daysSum = 0;
    for (let run = 0; run < RUNS; run++) {
      const rng = createRng(run * 7919 + Math.round(p * 100));
      // 참여자는 매일 확률 p 로 접속해 남은 공격 횟수를 다 쓴다 (참여율 = 일별 접속 확률)
      let left = hp;
      let killedAt = -1;
      for (let day = 0; day < DAYS && killedAt < 0; day++) {
        for (let m = 0; m < MEMBERS && killedAt < 0; m++) {
          if (rng() >= p) continue;
          for (let a = 0; a < guildBossData.ticketsPerDay; a++) {
            left -= rollDamage(CP, rng);
            if (left <= 0) {
              killedAt = day + (m + 1) / MEMBERS; // 그날 안의 대략적 시점
              break;
            }
          }
        }
      }
      if (killedAt >= 0) {
        kills++;
        daysSum += killedAt;
      }
    }
    const attacksPerMember = p * DAYS * guildBossData.ticketsPerDay;
    const lossPct = (1 - Math.pow(1 - guildBossData.lossRatio, attacksPerMember)) * 100;
    console.log(
      `${(p * 100).toFixed(0).padStart(5)}% | ${((kills / RUNS) * 100).toFixed(0).padStart(7)}% | ${kills ? (daysSum / kills).toFixed(2).padStart(15) : '              -'} | ${(((CP * attacksPerMember) / hp) * 100).toFixed(0).padStart(14)}% | ${lossPct.toFixed(0).padStart(8)}%`,
    );
  }
}
