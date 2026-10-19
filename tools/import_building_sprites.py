"""image/ 의 건물 이미지(종족별 3단계 진화형)를 게임 에셋으로 가져온다.

- image/<race>_buildings_*/building_<type>_<tier>.png -> assets/sprites/buildings/<race>/<building_id>_<tier>.png
- assets/manifest.json 에 `buildings/<race>/<building_id>_<tier>` 키를 등록한다.
- 건물 레벨 -> 이미지 단계 매핑은 data/buildings.json 의 `spriteTiers` (레벨 하한 목록) 로 정한다.
  예) [1, 4, 7] -> Lv.1~3: 1단계, Lv.4~6: 2단계, Lv.7~: 3단계. 영주관은 영지 레벨 기준.

사용법: python tools/import_building_sprites.py   (여러 번 실행해도 같은 결과)
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "image"
DST = ROOT / "assets" / "sprites" / "buildings"
MANIFEST = ROOT / "assets" / "manifest.json"

# 파일명 속 건물 이름 -> building id (data/buildings.json)
TYPE_MAP = {
    "townhall": "town_hall",
    "barracks": "barracks",
    "farm": "farm",
    "lumber": "lumber_camp",
    "lumbercamp": "lumber_camp",
    "quarry": "quarry",
    "mine": "mine",
    "smithy": "smithy",
    "house": "house",
    "warehouse": "warehouse",
}
RACES = {"human", "elf", "dwarf", "undead", "orc"}


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sprites = manifest.setdefault("sprites", {})
    seen = set()
    for f in sorted(SRC.glob("*_buildings_*/**/building_*.png")):
        race = f.relative_to(SRC).parts[0].split("_")[0]
        m = re.match(r"building_([a-z]+)_(\d+)$", f.stem)
        if race not in RACES or not m:
            print(f"건너뜀: {f}")
            continue
        building_id = TYPE_MAP.get(m.group(1))
        if not building_id:
            print(f"매핑 없음, 건너뜀: {f.name}")
            continue
        key = f"buildings/{race}/{building_id}_{m.group(2)}"
        if key in seen:  # 같은 파일이 여러 폴더에 중복 납품된 경우
            continue
        seen.add(key)
        out_dir = DST / race
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{building_id}_{m.group(2)}.png"
        shutil.copy(f, out)
        sprites[key] = f"sprites/buildings/{race}/{out.name}"
        print(f"{f.parent.name}/{f.name} -> {key}")
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
