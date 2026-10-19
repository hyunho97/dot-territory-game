"""image/game_icons_ui_and_events_complete/ 의 UI·아이콘·이벤트 이미지를 게임 에셋으로 가져온다.

- <카테고리>/<이름>.png -> assets/sprites/ui/<카테고리>/<이름>.png
- manifest 키: `<카테고리>/<이름>` (예: icons/res_gold, emblems/human, events/explore_treasure, tiles/grass)
  - equip/<type> 은 기존 규칙과 같고, buildings/under_construction 은 건설 중 건물 이미지.
사용법: python tools/import_ui_assets.py   (여러 번 실행해도 같은 결과)
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "image" / "game_icons_ui_and_events_complete"
DST = ROOT / "assets" / "sprites" / "ui"
MANIFEST = ROOT / "assets" / "manifest.json"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sprites = manifest.setdefault("sprites", {})
    count = 0
    for f in sorted(SRC.glob("*/*.png")):
        cat = f.parent.name
        out_dir = DST / cat
        out_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(f, out_dir / f.name)
        sprites[f"{cat}/{f.stem}"] = f"sprites/ui/{cat}/{f.name}"
        count += 1
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{count}장 가져옴")


if __name__ == "__main__":
    main()
