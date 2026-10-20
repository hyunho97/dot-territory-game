# 🎵 게임 BGM & 효과음 에셋 매니페스트 (Game Audio Pack)

여태 제작된 16-bit 레트로 중세 판타지 도트 아트 그래픽 스타일에 맞추어, SNES / 메가드라이브 황금기 클래식 RPG 감성을 구현한 고음질 게임 오디오 3종 세트입니다.

---

## 1. 수록 음원 목록 및 상세 사양

| 트랙 종류 | 파일 키 | 파일명 (MP3 / WAV) | 재생 시간 | 음원 포맷 및 레이트 | 음악적 특징 및 사운드 구성 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **영지 화면 BGM** | `bgm_territory` | `bgm_territory.mp3`<br>`bgm_territory.wav` | 28.7초 (무한 루프) | 44.1kHz / 192kbps / 16-bit | **G Major 평화로운 중세 영지 테마**<br>• 베이스: 묵직하고 따뜻한 어쿠스틱 베이스 라인<br>• 반주: 류트(Lute) 8분음표 분산화음 아르페지오<br>• 패드: 부드러운 오케스트라 현악 앙상블 서스테인<br>• 멜로디: 서정적인 목관 플루트(Wooden Flute) 주선율과 비브라토 |
| **5초 전투 사운드** | `bgm_battle_short` | `bgm_battle_short.mp3`<br>`bgm_battle_short.wav` | 5.2초 (단발 재생) | 44.1kHz / 192kbps / 16-bit | **D Dorian → D Major 긴장감 넘치는 전투 팡파르**<br>• 타악기: 148 BPM 빠른 군악 킥/스네어 행진 드럼 비트<br>• 베이스: 16분음표 펌핑 스타카토 베이스<br>• 브라스: 영웅적인 금관악기(Brass) 찌르기 및 상승 런<br>• 피날레: 3.25초 부근 승리/교전 클라이맥스 코드와 심벌즈 크래시 |
| **건물 완성/업그레이드 SFX** | `sfx_building_upgrade` | `sfx_building_upgrade.mp3`<br>`sfx_building_upgrade.wav` | 2.2초 (단발 재생) | 44.1kHz / 192kbps / 16-bit | **경쾌하고 보람찬 건설/승급 축하 효과음**<br>• 1단계 (0.0~0.2s): 모루를 타격하는 2연타 메탈릭 해머 클링크<br>• 2단계 (0.35~0.8s): C Major 펜타토닉 상승 매직 하프/차임 글리산도<br>• 3단계 (0.95~2.2s): 찬란한 브라스/종소리 승리 화음과 반짝이는 잔향 |

---

## 2. 인게임 적용 가이드 (Phaser 3 / Web Audio)

### 리소스 사전 로드 (`preload`)
```javascript
// Phaser 3 기준
this.load.audio('bgm_territory', 'assets/audio/bgm_territory.mp3');
this.load.audio('bgm_battle', 'assets/audio/bgm_battle_short.mp3');
this.load.audio('sfx_upgrade', 'assets/audio/sfx_building_upgrade.mp3');
```

### 사운드 재생 제어 (`create` / `events`)
```javascript
// 1. 영지 화면 진입 시 무한 루프 재생
const territoryBgm = this.sound.add('bgm_territory', { loop: true, volume: 0.7 });
territoryBgm.play();

// 2. 5초 전투 연출 시 재생 (BGM 일시 정지 후 전투음 재생)
function playBattleSequence(scene) {
    territoryBgm.pause();
    const battleSound = scene.sound.add('bgm_battle', { volume: 0.85 });
    battleSound.play();
    battleSound.once('complete', () => {
        territoryBgm.resume();
    });
}

// 3. 건물 건설/업그레이드 완료 시
function onBuildingUpgraded(scene) {
    scene.sound.play('sfx_upgrade', { volume: 0.9 });
}
```

---

## 3. 압축 파일 구조 (`game_audio_bgm_and_sfx.zip`)
```text
game_audio_bgm_and_sfx.zip
└── audio/
    ├── bgm_territory.mp3 (웹 및 모바일 최적화 경량 포맷)
    ├── bgm_territory.wav (비압축 고음질 원본)
    ├── bgm_battle_short.mp3
    ├── bgm_battle_short.wav
    ├── sfx_building_upgrade.mp3
    └── sfx_building_upgrade.wav
```
