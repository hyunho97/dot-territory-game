"""sound/ 폴더의 mp3 를 게임 에셋(assets/audio/)으로 복사한다. (wav 원본은 용량 때문에 가져오지 않는다)
사용법: python tools/import_audio.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DST = ROOT / "assets" / "audio"
DST.mkdir(parents=True, exist_ok=True)
n = 0
for f in sorted((ROOT / "sound").rglob("*.mp3")):
    shutil.copy(f, DST / f.name)
    n += 1
print(f"{n}개 가져옴 -> {DST}")
