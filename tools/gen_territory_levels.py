"""data/territory_levels.json 을 생성한다 (영지 레벨업 비용/시간 곡선).

사용법: python tools/gen_territory_levels.py [--cost-growth 2.0] [--time-growth 1.8]
이후 `node tools/balance_sim.mjs` 로 도달 시간을 확인하며 조정한다.
레벨 N(>=2) 비용 = 기본비용 × cost_growth^(N-2). 철은 Lv.4, 금은 Lv.5 부터 요구한다.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "territory_levels.json"

MAX_TROOPS = {1: 10, 2: 25, 3: 50, 4: 75, 5: 100, 6: 150, 7: 200, 8: 260, 9: 330, 10: 400}
UNLOCK_TIER = {1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 4, 10: 5}
BASE = {"food": 150, "wood": 300, "stone": 200}
IRON_BASE, GOLD_BASE = 100 / 1.8, 100 / 1.8
BASE_TIME_SEC = 60
# 레벨업 대기 시간(초): 방치형 기준 Lv.10 약 1년, Lv.3 은 하루 이내 (과금/이벤트 가속 여지를 위해 타이머가 지배)
DAY = 86400
TIME_SEC = {2: 60, 3: 1800, 4: 2 * DAY, 5: 5 * DAY, 6: 12 * DAY, 7: 25 * DAY, 8: 50 * DAY, 9: 100 * DAY, 10: 170 * DAY}
# 초반(Lv.3)은 시작 자원과 방치 생산으로 하루 안에 도달하도록 비용을 낮춘다
COST_SCALE = {3: 0.35}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cost-growth", type=float, default=2.0)
    ap.add_argument("--time-growth", type=float, default=1.8)
    args = ap.parse_args()

    levels = []
    for n in range(1, 11):
        e = {"level": n, "maxTroops": MAX_TROOPS[n], "unlockTier": UNLOCK_TIER[n]}
        if n >= 2:
            k = args.cost_growth ** (n - 2) * COST_SCALE.get(n, 1.0)
            cost = {r: v * k for r, v in BASE.items()}
            if n >= 4:
                cost["iron"] = IRON_BASE * k
            if n >= 5:
                cost["gold"] = GOLD_BASE * k
            e["cost"] = {r: int(round(v / 10.0) * 10) for r, v in cost.items()}
            e["timeSec"] = TIME_SEC[n]
        levels.append(e)
    OUT.write_text(json.dumps({"levels": levels}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"cost_growth={args.cost_growth} time_growth={args.time_growth} -> {OUT.name}")


if __name__ == "__main__":
    main()
