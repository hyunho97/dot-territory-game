"""image/ 폴더의 납품 이미지를 게임 에셋으로 가져온다.

- image/rpg_characters_128x128_transparent/<종족>/NN_이름_영문.png -> assets/sprites/units/<unit_id>.png
- image/rpg_races_pixel_art/N_종족_라인업.jpg                       -> assets/races/<race_id>.jpg (688x384)
- assets/manifest.json 에 `units/<unit_id>`, `races/<race_id>` 키를 등록한다.

사용법: python tools/import_unit_sprites.py   (여러 번 실행해도 같은 결과)
"""
import json
import re
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC_UNITS = ROOT / "image" / "rpg_characters_128x128_transparent"
SRC_RACES = ROOT / "image" / "rpg_races_pixel_art"
DST_UNITS = ROOT / "assets" / "sprites" / "units"
DST_RACES = ROOT / "assets" / "races"
MANIFEST = ROOT / "assets" / "manifest.json"

# 파일명 속 영문 이름 -> unit id (data/units.json)
UNIT_MAP = {
    "Militia": "human_militia",
    "Warrior": "human_warrior",  # 인간 폴더 기준. 오크 폴더의 Warrior 는 아래 RACE_OVERRIDE 로 구분
    "Archer": "human_archer",
    "Mage": "human_mage",
    "Knight": "human_knight",
    "DragonKnight": "human_dragon",
    "ApprenticeArcher": "elf_apprentice_archer",
    "Elementalist": "elf_elementalist",
    "GuardianOfForest": "elf_forest_guardian",
    "MinerSoldier": "dwarf_miner_soldier",
    "Shieldbearer": "dwarf_shield",
    "Crossbowman": "dwarf_crossbowman",
    "RuneWarrior": "dwarf_rune_warrior",
    "SkeletonSoldier": "undead_skeleton",
    "SkeletonArcher": "undead_skeleton_archer",
    "ApprenticeLich": "undead_lich_apprentice",
    "DeathKnight": "undead_death_knight",
    "BoneDragon": "undead_bone_dragon",
    "Lich": "undead_lich",
    "OrcGrunt": "orc_grunt",
    "OrcWarrior": "orc_warrior",
    "OrcThrower": "orc_thrower",
    "OrcWarlord": "orc_warlord",
}
# 같은 영문 이름이 종족마다 다른 경우 (폴더 영문 종족명 -> {이름: unit id})
RACE_OVERRIDE = {
    "Elf": {"Archer": "elf_archer"},
}
RACE_IDS = {"1": "human", "2": "elf", "3": "dwarf", "4": "undead", "5": "orc"}


def main() -> None:
    DST_UNITS.mkdir(parents=True, exist_ok=True)
    DST_RACES.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sprites = manifest.setdefault("sprites", {})

    for f in sorted(SRC_UNITS.glob("*/*.png")):
        race_folder = f.parent.name.split("_")[-1]  # '1_인간_Human' -> 'Human'
        eng = re.sub(r"^\d+_", "", f.stem).split("_", 1)[1]  # '02_전사_Warrior' -> 'Warrior'
        unit_id = RACE_OVERRIDE.get(race_folder, {}).get(eng) or UNIT_MAP.get(eng)
        if not unit_id:
            print(f"매핑 없음, 건너뜀: {f.name}")
            continue
        out = DST_UNITS / f"{unit_id}.png"
        shutil.copy(f, out)
        sprites[f"units/{unit_id}"] = f"sprites/units/{unit_id}.png"
        print(f"{f.name} -> units/{unit_id}")

    for f in sorted(SRC_RACES.glob("*.jpg")):
        race_id = RACE_IDS.get(f.name.split("_")[0])
        if not race_id:
            continue
        out = DST_RACES / f"{race_id}.jpg"
        Image.open(f).convert("RGB").resize((688, 384), Image.LANCZOS).save(out, quality=88, optimize=True)
        sprites[f"races/{race_id}"] = f"races/{race_id}.jpg"
        print(f"{f.name} -> races/{race_id}")

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
