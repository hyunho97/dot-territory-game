"""레퍼런스 JPG -> 배경 제거(투명 PNG) -> nearest-neighbor 다운스케일.

사용법:  python tools/process_sprites.py [--sizes 64 128 256] [--tolerance 40]
입력:    assets/reference/*.jpg
출력:    assets/sprites/<영문이름>_<크기>.png
"""
import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "reference"
DST = ROOT / "assets" / "sprites"
SENTINEL = (255, 0, 255)

# 레퍼런스 파일명(영문 부분) -> 게임 에셋 이름
NAME_MAP = {
    "warrior": "human_warrior",
    "archer": "human_archer",
    "mage": "human_mage",
    "skeleton": "undead_skeleton",
    "dragon": "human_dragon",
    "bone_dragon": "undead_bone_dragon",
}


def asset_name(path: Path) -> str:
    stem = re.sub(r"^\d+_", "", path.stem)  # '1_전사_warrior' -> '전사_warrior'
    key = stem.split("_", 1)[1] if "_" in stem and not stem.isascii() else stem
    return NAME_MAP.get(key, key)


def remove_background(img: Image.Image, tolerance: int) -> Image.Image:
    rgb = img.convert("RGB")
    w, h = rgb.size
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(rgb, corner, SENTINEL, thresh=tolerance)
    rgba = rgb.convert("RGBA")
    px = rgba.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][:3] == SENTINEL:
                px[x, y] = (0, 0, 0, 0)
    return rgba


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", type=int, nargs="+", default=[64, 128, 256])
    ap.add_argument("--tolerance", type=int, default=40)
    args = ap.parse_args()

    DST.mkdir(parents=True, exist_ok=True)
    files = sorted(SRC.glob("*.jpg"))
    if not files:
        print(f"레퍼런스 이미지가 없습니다: {SRC}")
        return
    for f in files:
        name = asset_name(f)
        rgba = remove_background(Image.open(f), args.tolerance)
        bbox = rgba.getbbox()
        if bbox:
            rgba = rgba.crop(bbox)
        side = max(rgba.size)  # 정사각형 캔버스, 바닥 중앙 정렬
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(rgba, ((side - rgba.width) // 2, side - rgba.height))
        for s in args.sizes:
            out = DST / f"{name}_{s}.png"
            canvas.resize((s, s), Image.NEAREST).save(out)
            print(f"{f.name} -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
