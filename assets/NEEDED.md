# 필요한 에셋 목록

`assets/manifest.json` 에 등록하면 코드 수정 없이 플레이스홀더가 교체됩니다.

## 유닛 (128×128 투명 PNG) — 인간/엘프/드워프/언데드/오크 Tier 1~4 + 인간·언데드 Tier 5 적용 완료
- [x] 24종 적용 (`image/rpg_characters_128x128_transparent` → `python tools/import_unit_sprites.py` 로 가져옴)
- 참고: 인간 Tier 5 는 "드래곤 기사"(DragonKnight) 이미지로 확정 → 유닛명을 '드래곤 기사'로 변경
- 참고: 언데드 "리치"는 새로 생긴 Tier 4 마법 유닛(`undead_lich`)으로 추가
- [ ] 엘프/드워프/오크 Tier 5 — 데이터는 추가됨, 이미지 필요: `units/elf_ancient_treant`(고대 나무정령), `units/dwarf_steel_golem`(강철 골렘), `units/orc_ogre_chief`(오거 족장)
- [ ] (선택) 걷기/공격/피격 애니메이션 프레임, 전투 연출용 투사체(화살/마법)

## 건물 (128×128, 종족별 3단계 진화형 — 건물 레벨 1~3 / 4~6 / 7~ 에 따라 단계 변경, 영주관은 영지 레벨 기준)
- 단계 기준은 `data/buildings.json` 의 `spriteTiers` ([1, 4, 7]). 가져오기: `python tools/import_building_sprites.py`
- [x] 인간: 영주관, 막사, 농장, 벌목장, 채석장, 광산, 대장간, 창고 (각 3단계, 24장 적용 완료)
- [x] 5종족 건물 8종(영주관·막사·농장·벌목장·채석장·광산·창고·대장간) × 3단계 적용 완료
- [ ] 전 종족 주거지(house) 3단계 — 아직 이미지 없음(임시 사각형)
  - 파일명 규칙: `image/<race>_buildings_*/building_<종류>_<1~3>.png` (종류: townhall, barracks, farm, lumbercamp, quarry, mine, house, warehouse, smithy)
- [ ] (선택) 건설 중 이미지(공사 비계), 마법탑/사원/성벽/훈련장/용의 둥지/묘지 (후속 건물)

## 타일 / UI
- [ ] 지형 타일 (잔디, 길, 물) 32×32 또는 64×64
- [ ] 자원 아이콘 5종 (식량/목재/석재/철/금) 16×16
- [ ] UI 패널/버튼 9-slice, 종족 문장(엠블럼) 5종
- [ ] 장비 아이콘 (무기/방어구/방패/장신구) × 등급 색상
- [ ] 도트 폰트 로컬 파일 (현재 Google Fonts DotGothic16 사용 — 오프라인 대비 필요 시)

## 영지 전경 (완료)
- [x] 5종족 × 레벨 1~10 = 50장 (`assets/territory/<race>_<NN>.jpg`, 768×768, manifest 키 `territory/<race>_<NN>`)
- 영지 레벨 11 이상은 레벨 10 이미지를 재사용합니다.

## 장비 (Phase 4 — 현재 등급 색 테두리 + 글자 플레이스홀더)
- [ ] 장비 아이콘 4종 × 5등급(또는 종류별 1장 + 등급 테두리): 무기/방어구/방패/장신구, 64×64
  - manifest 키: `equip/weapon`, `equip/armor`, `equip/shield`, `equip/accessory` (등록하면 자동 교체)
- [ ] 대장간 건물 이미지, 제작 완료 이펙트

## 종족 선택 화면 (완료)
- [x] 종족 라인업 5장 (`assets/races/<race>.jpg`, manifest 키 `races/<race>`)

## 콘텐츠 이벤트 (퀘스트/침공/교역/연구) — 현재 텍스트와 색 사각형으로 표시
- [ ] 교역소(`market`), 연구소(`lab`) 건물 이미지 3단계 (종족별; 파일명 `building_market_1~3.png`, `building_lab_1~3.png`) — 현재 색 사각형
  - import_building_sprites.py 의 TYPE_MAP 에 `market`, `lab` 은 이미 대응시키면 되는 id 와 같은 이름이라, 파일명만 `building_market_*`, `building_lab_*` 로 주시면 됩니다 (스크립트에 매핑 한 줄 추가 필요)
- [ ] NPC 침공 연출용 이미지: 침공군(오크 졸병/전사/투척병/워로드는 유닛 이미지 재사용 중), 침공 경고 아이콘
- [ ] 퀘스트/출석/랭킹/교역/연구 아이콘 (현재 글자 버튼), 퀘스트 알림 뱃지, 출석 7일 카드 일러스트(선택)
- [ ] 탐험 이벤트 일러스트(선택): 보물 상자, 매복, 장비 발견
- [ ] 연구 항목 아이콘 4종 (생산 효율/훈련술/전술/보급술)
