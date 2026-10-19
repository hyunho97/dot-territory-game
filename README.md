# 도트 영지 경영 웹게임

명세서: [GAME_SPEC.md](GAME_SPEC.md) — 현재 진행: **Phase 0~5 구현** (진입 플로우, 영지/건설/레벨업, 탐사, 병사 모집, 장비 제작, 자동 전투(PvE), 결투(PvP))

## 요구 사항
- Node.js 22.5+ (개발 환경: 24 LTS, 내장 `node:sqlite` 사용)
- Python 3.10+ + Pillow (스프라이트 처리 스크립트용)

## 실행
```bash
npm install
npm run dev        # 서버(3001) + 클라이언트(5173) 동시 실행
```
브라우저에서 http://localhost:5173 접속 → 회원가입(아이디/비밀번호/닉네임) 또는 로그인 → 서버 선택 → 종족 선택 → 영지 생성 → 영지 화면.
로그인 후 이미 영지가 있는 서버를 고르면 종족 선택을 건너뛰고 바로 입장합니다.

| 명령 | 설명 |
|------|------|
| `npm run dev` | 서버 + 클라이언트 개발 실행 |
| `npm run build` | 타입 체크 + 클라이언트 번들 |
| `npm run typecheck` | 전체 타입 체크 |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run sprites` | `assets/reference/*.jpg` → 배경 제거 + 도트 리사이즈 → `assets/sprites/` |

## 구조
```
assets/        reference/(원본) sprites/(가공 PNG) manifest.json(에셋 ID↔경로) NEEDED.md
data/          *.json  종족/유닛/건물/영지레벨/서버/게임설정 (밸런스는 모두 여기서)
client/src/    main.ts, ui/(HTML 화면), scenes/(Phaser 영지), api/, i18n/ko.json
server/src/    index.ts, routes/, services/, db/ (SQLite: server/game.db 자동 생성)
tools/         process_sprites.py
```

## 설계 메모
- 서버 권위: 캐릭터 생성 검증, 자원/병력/전투력(totalCP)은 서버가 계산. 클라이언트는 표시만.
- 데이터 주도: 시작 자원/건물/병력 수, 닉네임 길이, 서버 혼잡 기준 등 모두 `data/*.json`.
- 문자열은 `client/src/i18n/ko.json` 에서 관리 (`t('key')`).
- DB는 `node:sqlite` 를 얇게 감싼 구조. PostgreSQL 전환 시 `server/src/db/` 와 서비스의 SQL만 교체하면 됩니다 (ORM 미도입, 아래 질문 참고).
- 인증: 아이디(영문 소문자·숫자·_ 4~20자)/비밀번호(8~64자) 계정. 비밀번호는 scrypt+솔트 해시로 저장, 세션 토큰은 30일 만료(로그아웃 시 폐기), 같은 아이디+IP 로그인 5회 실패 시 10분 차단. 이메일 인증/비밀번호 찾기는 아직 없음. 이전 닉네임 전용(게스트) 계정은 로그인할 수 없다.
- 스프라이트가 없는 유닛(민병, 엘프/드워프/오크 T1)은 플레이스홀더로 표시됩니다.

## 구현된 게임 기능 (Phase 1~3 + 탐사)
- 로그인 후 영지가 있으면 "기존 영지 계속하기 / 새로 만들기" 선택 (서버당 영지 1개)
- 영지 패널: 레벨별 건설 목록, 건설 타이머, **영지 레벨업(Lv.1~10)**, 자원 생산/창고/주거지 효과
- 탐사: 영지 주변 2D 지도의 자원지로 병력 파견 → 왕복 시간 후 수확
- 막사: 종족 유닛 목록(영지 레벨 잠금), 모집 큐, 종족 비용/속도 보정, 최대 병력 검증
- 모든 시간/비용/수량 검증은 서버가 수행 (타임스탬프 기반, 접속 시 정산)
- 밸런스: `data/buildings.json`, `territory_levels.json`, `units.json`, `exploration.json`, `game_config.json`
- 전투(PvE): 상대(`data/pve.json`) 선택 → 참전 병력 선택 → 서버 계산 → 연출 → 결과 창. 규칙은 GAME_SPEC 8-1장, 순수 함수는 `server/src/services/battle.ts`, 설정은 `data/battle_config.json`
- 테스트: `npm test -w server` (전투 승패/전멸/손실 예산/시드 재현)
- 대장간(Lv.3): 무기/방어구/방패/장신구 제작 → 완료 시 서버가 등급·보정(%)을 롤(종족 보정 반영) → 인벤토리/장착(슬롯당 1개)/분해. 장착 장비 보정 합이 전투력에 곱해짐. 설정: `data/equipment.json`
- 건물 업그레이드: 농장/벌목장/채석장/광산/주거지/창고 Lv.1~10 (건물 레벨 ≤ 영지 레벨), 비용 ×1.7^레벨, 시간 ×1.6^레벨, 건설 슬롯 공유. 설정: `data/buildings.json`
- 에셋 가져오기: `python tools/import_unit_sprites.py` (납품 이미지 `image/` → `assets/`, manifest 자동 등록)
- 결투(PvP): 같은 서버 영주 대상. 규칙은 `data/pvp_config.json` — 상대 전투력 50%~150% 범위, 공격 쿨타임 10분, 신규 보호 24시간(공격하면 해제), 약탈은 (보유 자원 - 보호량(500 + 창고 레벨당 300))의 10%, 방어자는 접속 여부와 무관하게 전 병력 자동 참전. 순수 규칙: `server/src/services/pvpRules.ts`(+테스트)
- 막사/대장간 업그레이드(Lv.1~10): 레벨당 모집/제작 속도 +5% (`speedBonus`, `data/buildings.json`)
- 건물 이미지: 종족/레벨 단계별 (`python tools/import_building_sprites.py`), 영지 화면 우측과 [영지] 패널에 표시. 이미지가 없는 종족/건물은 색 사각형
- 밸런스: `node tools/balance_sim.mjs` (도달 시간 시뮬레이션), 리포트 `docs/BALANCE.md`, 레벨업 곡선 생성 `python tools/gen_territory_levels.py`

## 접속 유지·돌발 변수·경제 선택 콘텐츠
- **접속 리포트**: 영지 입장 시 자리를 비운 동안의 자원 변화와 있었던 일(탐험/모집/제작/업그레이드/침공/공격받음)을 요약. 하트비트는 `GET /api/character/me?touch=1`, 입장은 `POST /api/session/enter`
- **퀘스트**: 튜토리얼 6개 + 일일 4개(+완주 보너스: 장비) + 출석 7일 주기. 기준일은 KST 자정. 데이터 `data/quests.json`, 서비스 `server/src/services/questService.ts`, 진행도 기록은 `questEvents.recordEvent`(라우트에서 호출)
- **탐험 랜덤 이벤트**: 복귀 시 35% 확률로 추가 수확/보물/장비 발견/매복(병력 손실). `data/exploration.json`, 순수 함수 `exploreEvents.ts`(+테스트)
- **NPC 침공**: 6시간(±30%)마다 영지 전 병력이 방어. 승리 시 보상, 패배 시 병력 30% 손실 + 자원 약탈. 신규 보호 기간과 영지 Lv.2 미만은 제외. `data/raids.json`, `raidService.ts`
- **교역소**(Lv.4): 자원 환전, 수수료 20%에서 레벨당 -1%(최저 5%), 하루 거래 한도는 레벨당 5000(가치 기준). `data/market.json`
- **연구소**(Lv.5): 생산 효율/훈련술/전술/보급술 각 5레벨. 한 번에 하나, 영구 효과. `data/research.json`
- **랭킹**: 같은 서버 전투력/영지 레벨 순위
- **던전**(영지 Lv.3): 병력을 보내면 1층부터 자동 전투로 목표 층까지 진행. 층마다 손실 누적, 층별 자원 보상, 처음 도달한 층에서만 가속(5층마다)/장비(10층마다). 하루 3회 입장. `data/dungeon.json`
- **길드**(영지 Lv.3): 서버별 길드 창설(금 500)/가입/탈퇴/추방/길드장 위임/해산/공지, 자원 기부 → 길드 경험치(하루 가치 한도) → 길드 레벨(1~10)에 따라 정원 증가 및 멤버 전원 생산·전투력 버프. `data/guild.json`
- **길드 보스 레이드**: 길드장이 보스(트롤/거인/용, 길드 레벨로 등급 결정)를 소환하면 72시간 동안 길드원이 하루 2번 병력을 보내 함께 체력을 깎음. 처치 시 참가자 전원 보상 + 길드 경험치, 피해 1위 장비. `data/guild_boss.json`
- **가속**: 퀘스트/출석 보상으로 받는 "가속(분)" 을 보유하고, 영지 레벨업·건물 건설/업그레이드·연구 타이머에 10분/1시간/전부 단위로 사용. 서버가 남은 시간만큼만 차감 (`POST /api/speedup`). 추후 과금/이벤트 지급 연결 지점
  - 획득 경로: 튜토리얼/출석/일일 완주 보너스, PvE 스테이지 **첫 클리어**(5~60분, `data/pve.json`), NPC 침공 방어 승리(10분, `data/raids.json`), 탐험 랜덤 이벤트 '가속 발견'(5~15분, `data/exploration.json`)

## 로컬 실행·배포 준비 (무료 기반)

- 개발: `npm run dev` (서버 3001 + 클라이언트 5173). 환경 변수는 `.env.example` 참고, 기본값 그대로 쓰면 된다.
- 한 프로세스로 실행: `npm run start:prod` — 클라이언트를 빌드하고 서버가 함께 서빙 (`SERVE_CLIENT=1`, `HOST=0.0.0.0`, 포트 3001).
- 상태 확인: `GET /api/health`. 보안 헤더(nosniff, X-Frame-Options, Referrer-Policy)를 기본 적용, HTTPS 프록시 뒤(`TRUST_PROXY=1`)에서는 HSTS 도 적용.
- 백업: `npm run backup` → `server/backups/` 에 DB 스냅샷 (최근 10개 유지, 서버가 켜진 상태에서도 안전).
- 요청 크기 100KB 제한, 가입은 IP 당 시간당 10건, 로그인 실패 5회 시 10분 차단 (메모리 기반, 재시작 시 초기화).
- 공개할 때 필요한 것: HTTPS 와 영구 디스크(SQLite). 무료로 시험하려면 Cloudflare Tunnel 같은 터널로 내 PC 를 잠시 공개하는 방법이 있다. 배포는 아직 하지 않았다.
