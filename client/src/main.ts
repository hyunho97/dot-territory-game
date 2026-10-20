import './style.css';
import type Phaser from 'phaser';
import { ApiError, api, loadManifest, session } from './api/client';
import type { CharacterState, QuestView, ServerInfo } from './api/client';
import { errorMessage, t } from './i18n';
import { h, mount } from './ui/dom';
import { describeEvent } from './ui/eventText';
import {
  RES_COLORS,
  addHeadButton,
  closeAllModals,
  openBuildingPanel,
  openExplorePanel,
} from './ui/panels';
import type { TerritoryScene } from './scenes/TerritoryScene';
import type { PanelCtx } from './ui/panels';
import { openBarracksPanel } from './ui/barracks';
import { openBattlePanel } from './ui/battle';
import { openMarketPanel } from './ui/market';
import { openQuestPanel, hasClaimable } from './ui/quests';
import { iconEl } from './ui/icons';
import { openDungeonPanel } from './ui/dungeon';
import { openAdminPanel } from './ui/admin';
import { LOCAL, bootLocal, openSaveManager } from 'virtual:local-boot';
import {
  onSoundChange,
  playSfx,
  setSoundEnabled,
  setSoundVolume,
  soundEnabled,
  soundVolume,
  startBgm,
} from './audio';
import {
  canInstall,
  disablePush,
  enablePush,
  isIOS,
  isStandalone,
  onPwaChange,
  promptInstall,
  pushEnabled,
  pushSupported,
  registerServiceWorker,
} from './pwa';
import { currentStep, guideEl, highlightBuilding, openIntro, openOutro } from './ui/tutorial';
import type { DockKey } from './ui/tutorial';
import { openGuildPanel } from './ui/guild';
import { openRankingPanel } from './ui/ranking';
import { openReportModal } from './ui/report';
import { openResearchPanel } from './ui/research';
import { openSmithyPanel } from './ui/smithy';
import { modeScreen, raceScreen, serverScreen, titleScreen } from './ui/screens';
import type { Nav } from './ui/screens';

const root = document.getElementById('app')!;
let game: Phaser.Game | null = null;

function destroyGame(): void {
  game?.destroy(true);
  game = null;
  closeAllModals();
  document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
}

async function show(build: () => Promise<HTMLElement>): Promise<void> {
  destroyGame();
  mount(root, h('div', { class: 'screen' }, t('common.loading')));
  try {
    mount(root, await build());
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'UNKNOWN';
    mount(
      root,
      h(
        'div',
        { class: 'screen' },
        h('div', { class: 'error' }, errorMessage(code)),
        h('button', { class: 'btn', onclick: () => nav.toTitle() }, t('common.back')),
      ),
    );
  }
}

async function territoryScreen(initial: CharacterState): Promise<HTMLElement> {
  let ch = initial;
  const [
    { buildings, categories, upgrade, spriteTiers },
    { levels },
    { units },
    manifest,
    { races },
    equipment,
  ] = await Promise.all([
    api.buildings(),
    api.levels(),
    api.units(),
    loadManifest(),
    api.races(),
    api.equipmentData(),
  ]);
  const race = races.find((r) => r.id === ch.race)!;

  // 개발용 미리보기: URL에 ?lv=1~10 을 붙이면 해당 레벨 영지 이미지를 표시 (표시 전용)
  const previewLv = Number(new URLSearchParams(location.search).get('lv'));
  const withPreview = (c: CharacterState): CharacterState =>
    import.meta.env.DEV && previewLv >= 1 ? { ...c, territoryLevel: previewLv } : c;
  ch = withPreview(ch);

  const topbar = h('div', { class: 'topbar' });
  const dock = h('div', { class: 'dock' });
  const sceneInit = () => ({
    character: ch,
    buildingData: buildings,
    units,
    manifest,
    spriteTiers,
    highlightType: highlightBuilding(tutorialStep()),
    onTimerDone: () => void ctx.refresh().catch(() => undefined),
    tutorialActive: !!tutorialStep(),
    onBuildingClick: (type: string, spot?: { x: number; y: number }) => {
      // 빈 터("+")는 건설 창, 지은 막사/대장간/교역소/연구소는 각자의 기능 창, 나머지는 건물 창
      const isGhost = !!spot;
      const fn = isGhost ? undefined : BUILDING_PANEL[type];
      const s = tutorialStep();
      // 튜토리얼 중에는 안내된 단계 밖의 조작을 막는다
      if (s && (fn ? fn.dock : 'territory') !== s.target) return;
      const done = ch.buildings.some(
        (b) => b.type === type && (b.finishAt === null || b.finishAt <= ch.serverNow),
      );
      if (fn && done) {
        fn.open(ctx);
        if (!s)
          addHeadButton(t('territory.manageBuilding'), () => {
            closeAllModals();
            openBuildingPanel(ctx, type);
          });
        return;
      }
      openBuildingPanel(ctx, type);
    },
    onPlaceBuilding: async (type: string, x: number, y: number): Promise<string | null> => {
      try {
        await api.build(ch.serverId, type, { x, y });
        await ctx.refresh();
        return null;
      } catch (e) {
        return errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN');
      }
    },
    onMoveBuilding: async (id: number, x: number, y: number): Promise<string | null> => {
      try {
        await api.moveBuilding(ch.serverId, id, x, y);
        await ctx.refresh();
        return null;
      } catch (e) {
        return errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN');
      }
    },
  });
  // 서버 시각 기준 시계 + 일꾼(동시 건설 슬롯) 표시. 1초마다 갱신
  let clockOffset = ch.serverNow - Date.now();
  const clockEl = h('span', { class: 'clock' });
  const workerEl = h('span', { class: 'workers', title: t('territory.workersTip') });
  const tickClock = () => {
    const nowMs = Date.now() + clockOffset;
    const d = new Date(nowMs);
    const p2 = (n: number) => String(n).padStart(2, '0');
    clockEl.textContent = t('territory.clock', {
      y: 1200 + (d.getFullYear() - 2026),
      m: d.getMonth() + 1,
      d: d.getDate(),
      hh: p2(d.getHours()),
      mm: p2(d.getMinutes()),
    });
    const busy = ch.buildings.filter(
      (b) =>
        (b.finishAt !== null && b.finishAt > nowMs) ||
        (b.upgradeFinishAt !== null && b.upgradeFinishAt > nowMs),
    ).length;
    workerEl.textContent = t('territory.workers', {
      free: Math.max(0, ch.buildSlots - busy),
      max: ch.buildSlots,
    });
  };
  let wasConnected = false;
  const clockTimer = window.setInterval(() => {
    if (topbar.isConnected) wasConnected = true;
    else if (wasConnected) return clearInterval(clockTimer);
    tickClock();
  }, 1000);
  const logBar = h('div', { class: 'log' });
  const gameRoot = h('div', { id: 'game-root' });
  let pushOn = false; // 이 기기에서 완료 알림을 받는 중인지
  let isAdmin = false; // 테스트용 관리자 계정이면 하단 메뉴에 관리자 버튼을 보인다
  let questBadge = false; // 받을 수 있는 퀘스트/출석 보상이 있는지
  // 튜토리얼: 튜토리얼 퀘스트가 남아 있는 동안 안내 단계의 버튼만 누를 수 있다
  let tutorial: QuestView[] | null = null;
  let tutSkipped = false; // 관리자 전용 건너뛰기
  let hadStep = false;
  let lastStepKey = '';
  const guideBox = h('div', { class: 'guide-box' });
  const tutorialStep = () => (tutSkipped ? null : currentStep(tutorial));

  const dockBtn = (key: DockKey, label: string, onclick: () => void, icon: string): HTMLElement => {
    const step = tutorialStep();
    const locked = !!step && key !== step.target && key !== 'quest' && key !== 'admin';
    return h(
      'button',
      {
        class: `dock-btn${locked ? ' locked' : ''}${step && key === step.target ? ' hl' : ''}`,
        onclick: () => {
          if (!locked) onclick();
        },
      },
      iconEl(icon, 28, manifest) ?? h('span', { class: 'dock-ph' }),
      h('span', { class: 'dock-label' }, label),
      step && key === step.target ? h('span', { class: 'dock-arrow' }, '▼') : null,
    );
  };

  // 건물을 눌렀을 때 열리는 기능 창 (지은 건물만)
  const BUILDING_PANEL: Record<string, { dock: DockKey; open: (c: PanelCtx) => void }> = {
    barracks: { dock: 'barracks', open: openBarracksPanel },
    smithy: { dock: 'smithy', open: openSmithyPanel },
    market: { dock: 'market', open: openMarketPanel },
    lab: { dock: 'research', open: openResearchPanel },
  };

  const openQuest = (): void =>
    openQuestPanel(ctx, (q) => {
      questBadge = hasClaimable(q);
      applyTutorial(q.tutorial);
      renderTop();
    });
  // 튜토리얼이 다음 단계로 넘어가면 해야 할 창을 바로 열어 준다 (보상 수령 단계는 퀘스트 창)
  const openStepTarget = (step: ReturnType<typeof tutorialStep>): void => {
    if (!step) return;
    closeAllModals();
    if (step.ready) return openQuest();
    switch (step.target) {
      case 'territory':
        return openBuildingPanel(ctx, highlightBuilding(step) ?? undefined);
      case 'barracks':
        return openBarracksPanel(ctx);
      case 'explore':
        return openExplorePanel(ctx);
      case 'battle':
        return openBattlePanel(ctx);
      default:
    }
  };

  // 튜토리얼 상태 갱신: 처음이면 소개, 모두 끝나면 완료 안내
  const applyTutorial = (list: QuestView[]) => {
    const first = tutorial === null;
    tutorial = list;
    const step = tutorialStep();
    if (first && step && step.index === 0 && !step.ready) {
      const key = `tutIntro_${ch.serverId}`;
      try {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, '1');
          openIntro(() => openStepTarget(tutorialStep())); // 소개를 닫으면 첫 단계 창을 열어 준다
        }
      } catch {
        /* 저장소를 못 쓰는 환경이면 소개를 건너뜀 */
      }
    }
    const stepKey = step ? `${step.id}${step.ready}` : '';
    if (stepKey !== lastStepKey) {
      lastStepKey = stepKey;
      if (!first) {
        game?.scene.getScene('Territory')?.scene.restart(sceneInit()); // 강조 건물 갱신
        openStepTarget(step);
      }
    }
    if (step) hadStep = true;
    else if (hadStep) {
      hadStep = false;
      openOutro();
    }
  };

  const say = (msg: string): void => {
    logBar.textContent = msg;
  };
  const togglePush = async (): Promise<void> => {
    try {
      if (pushOn) {
        await disablePush();
        pushOn = false;
      } else if (!pushSupported()) {
        say(
          isIOS() && !isStandalone() ? t('territory.notifyIos') : t('territory.notifyUnsupported'),
        );
        return;
      } else {
        const r = await enablePush();
        if (r === 'denied') return say(t('territory.notifyDenied'));
        if (r === 'unsupported') return say(t('territory.notifyUnsupported'));
        pushOn = true;
        await api.pushTest().catch(() => undefined);
        renderTop();
        return say(t('territory.notifyDone'));
      }
    } catch (e) {
      say(errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN'));
    }
    renderTop();
  };

  const renderTop = () => {
    const chip = (...kids: (HTMLElement | string)[]) => h('span', { class: 'chip' }, ...kids);
    const brand = h(
      'div',
      { class: 'brand' },
      iconEl(`emblems/${ch.race}`, 28, manifest) ?? h('span'),
      h('strong', {}, ch.territoryName),
      h('span', { class: 'lvl-badge' }, t('territory.level', { n: ch.territoryLevel })),
    );
    const resBox = h('div', { class: 'res-box' });
    for (const [k, v] of Object.entries(ch.resources)) {
      const pct = Math.min(100, Math.round((v / Math.max(1, ch.storageCap)) * 100));
      resBox.append(
        h(
          'span',
          { class: `res${pct >= 95 ? ' full' : ''}`, title: t(`resource.${k}`) },
          iconEl(`icons/res_${k}`, 20, manifest) ??
            h('span', { class: 'swatch', style: `background:${RES_COLORS[k]}` }),
          h(
            'span',
            { class: 'res-text' },
            h('b', {}, String(v)),
            h('small', {}, `/${ch.storageCap}`),
            h(
              'span',
              { class: 'res-bar' },
              h('i', { style: `width:${pct}%;background:${RES_COLORS[k]}` }),
            ),
          ),
        ),
      );
    }
    const stats = h(
      'div',
      { class: 'stats' },
      clockEl,
      chip(workerEl),
      chip(t('territory.troopsFmt', { n: ch.totalTroops, max: ch.maxTroops })),
      chip(`${t('territory.cp')} ${ch.totalCP}`),
      h(
        'button',
        { class: 'btn small', onclick: () => setSoundEnabled(!soundEnabled()) },
        soundEnabled() ? t('territory.soundOn') : t('territory.soundOff'),
      ),
      h('input', {
        class: 'volume',
        type: 'range',
        min: '0',
        max: '100',
        value: String(Math.round(soundVolume() * 100)),
        title: t('territory.volume'),
        'aria-label': t('territory.volume'),
        // 위 막대를 다시 그리면 드래그가 끊기므로 소리 크기만 바꾼다
        oninput: (e: Event) => setSoundVolume(Number((e.target as HTMLInputElement).value) / 100),
      }),
      ...(!LOCAL && (pushSupported() || isIOS())
        ? [
            h(
              'button',
              { class: 'btn small', onclick: () => void togglePush() },
              pushOn ? t('territory.notifyOff') : t('territory.notifyOn'),
            ),
          ]
        : []),
      ...(canInstall()
        ? [
            h(
              'button',
              { class: 'btn small', onclick: () => void promptInstall() },
              t('territory.install'),
            ),
          ]
        : []),
      LOCAL
        ? h('button', { class: 'btn small', onclick: () => openSaveManager() }, t('save.menu'))
        : h('button', { class: 'btn small', onclick: () => nav.toMode() }, t('territory.logout')),
    );
    topbar.replaceChildren(brand, resBox, stats);

    dock.replaceChildren(
      dockBtn(
        'territory',
        t('territory.tabTerritory'),
        () => openBuildingPanel(ctx),
        'icons/nav_territory',
      ),
      dockBtn(
        'barracks',
        t('territory.tabBarracks'),
        () => openBarracksPanel(ctx),
        'icons/nav_barracks',
      ),
      dockBtn('smithy', t('territory.tabSmithy'), () => openSmithyPanel(ctx), 'icons/nav_smithy'),
      dockBtn('battle', t('territory.tabBattle'), () => openBattlePanel(ctx), 'icons/nav_battle'),
      dockBtn(
        'explore',
        t('territory.tabExplore'),
        () => openExplorePanel(ctx),
        'icons/nav_explore',
      ),
      dockBtn('market', t('territory.tabMarket'), () => openMarketPanel(ctx), 'icons/trade'),
      dockBtn(
        'dungeon',
        t('territory.tabDungeon'),
        () => openDungeonPanel(ctx),
        'icons/nav_dungeon',
      ),
      dockBtn('guild', t('territory.tabGuild'), () => openGuildPanel(ctx), 'icons/nav_guild'),
      dockBtn(
        'research',
        t('territory.tabResearch'),
        () => openResearchPanel(ctx),
        'icons/research',
      ),
      dockBtn('ranking', t('territory.tabRanking'), () => openRankingPanel(ctx), 'icons/ranking'),
      ...(isAdmin
        ? [dockBtn('admin', t('territory.tabAdmin'), () => openAdminPanel(ctx), 'icons/research')]
        : []),
      h(
        'button',
        {
          class: `dock-btn${questBadge ? ' badge-on' : ''}${tutorialStep()?.target === 'quest' ? ' hl' : ''}`,
          onclick: openQuest,
        },
        iconEl('icons/quest', 28, manifest) ?? '',
        h('span', { class: 'dock-label' }, t('territory.tabQuest')),
        questBadge ? (iconEl('icons/quest_badge', 18, manifest) ?? '') : '',
      ),
    );
    const step = tutorialStep();
    guideBox.replaceChildren(
      step
        ? guideEl(
            step,
            isAdmin
              ? () => {
                  tutSkipped = true;
                  renderTop();
                }
              : undefined,
          )
        : '',
    );
    clockOffset = ch.serverNow - Date.now();
    tickClock();
    const last = ch.logs[0];
    logBar.textContent = last ? describeEvent(last) : t('territory.logIdle');
  };

  const ctx: PanelCtx = {
    getChar: () => ch,
    beginPlacement: (type) => {
      closeAllModals();
      (game?.scene.getScene('Territory') as TerritoryScene | undefined)?.beginPlacement(type);
    },
    refresh: async () => {
      const sig = (c: CharacterState) =>
        JSON.stringify([
          c.territoryLevel,
          c.totalTroops,
          c.landRadius,
          c.buildings.map((b) => [b.id, b.level, b.finishAt, b.upgradeFinishAt, b.x, b.y, b.size]),
          tutorialStep()?.id ?? null,
        ]);
      const before = sig(ch);
      const prev = ch;
      ch = withPreview(await api.me(ch.serverId, true)); // 접속 중 하트비트 포함
      // 건설/업그레이드/영지 레벨업이 끝났으면 효과음
      const nowMs = ch.serverNow;
      const busy = (b: CharacterState['buildings'][number], at: number): boolean =>
        (b.finishAt !== null && b.finishAt > at) ||
        (b.upgradeFinishAt !== null && b.upgradeFinishAt > at);
      const finishedBuilding = prev.buildings.some((b) => {
        if (!busy(b, prev.serverNow)) return false;
        const cur = ch.buildings.find((x) => x.id === b.id);
        return !!cur && !busy(cur, nowMs);
      });
      if (finishedBuilding || ch.territoryLevel > prev.territoryLevel) playSfx('upgrade');
      renderTop();
      if (tutorialStep()) void refreshQuestBadge(); // 튜토리얼 진행도 반영
      if (sig(ch) !== before) {
        const scene = game?.scene.getScene('Territory');
        scene?.scene.restart(sceneInit());
      }
      return ch;
    },
    race,
    buildings,
    categories,
    upgrade,
    spriteTiers,
    levels,
    units,
    manifest,
    equipment,
  };

  const refreshQuestBadge = () =>
    api
      .quests(ch.serverId)
      .then((q) => {
        questBadge = hasClaimable(q);
        applyTutorial(q.tutorial);
        renderTop();
      })
      .catch(() => undefined);

  renderTop();
  void pushEnabled().then((on) => {
    pushOn = on;
    renderTop();
  });
  const alive = () => document.body.contains(wrap);
  onPwaChange(() => alive() && renderTop());
  onSoundChange(() => alive() && renderTop());
  startBgm();
  const wrap = h('div', { class: 'territory' }, topbar, guideBox, gameRoot, dock, logBar);

  // Phaser는 DOM 삽입 이후에 시작
  setTimeout(async () => {
    const { startTerritoryGame } = await import('./scenes/TerritoryScene');
    game = startTerritoryGame(gameRoot, sceneInit());
    portraitNow = (await import('./scenes/TerritoryScene')).isPortrait(gameRoot);
    // 입장: 자리를 비운 동안 있었던 일 요약 + 퀘스트 알림
    api
      .enterSession(ch.serverId)
      .then((r) => {
        if (r.report) openReportModal(r.report);
      })
      .catch(() => undefined);
    void refreshQuestBadge();
    api
      .adminStatus()
      .then((r) => {
        if (r.admin) {
          isAdmin = true;
          renderTop();
        }
      })
      .catch(() => undefined);
  }, 0);

  // 화면 방향/크기가 바뀌면(모바일 회전 등) 게임 화면을 다시 만든다
  let portraitNow: boolean | null = null;
  let resizeTimer = 0;
  const onResize = () => {
    if (!document.body.contains(wrap)) return window.removeEventListener('resize', onResize);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(async () => {
      const { startTerritoryGame, isPortrait } = await import('./scenes/TerritoryScene');
      const p = isPortrait(gameRoot);
      if (portraitNow === null) portraitNow = p;
      if (p === portraitNow || !game) return;
      portraitNow = p;
      game.destroy(true);
      game = startTerritoryGame(gameRoot, sceneInit());
    }, 300);
  };
  window.addEventListener('resize', onResize);

  // 생산/건설/침공 등 서버 정산 결과를 주기적으로 반영 (하트비트 겸용)
  let tick = 0;
  const poll = window.setInterval(() => {
    if (!document.body.contains(wrap)) return clearInterval(poll);
    void ctx.refresh().catch(() => undefined);
    if (++tick % 4 === 0) void refreshQuestBadge();
  }, 15000);
  return wrap;
}

const nav: Nav = {
  toTitle: () => void show(() => titleScreen(nav)),
  toMode: () => void show(() => modeScreen(nav)),
  toServers: (mode) => void show(() => serverScreen(nav, mode)),
  toRace: (server: ServerInfo) => void show(() => raceScreen(nav, server)),
  toTerritory: (ch) => void show(() => territoryScreen(ch)),
  // 로그인 직후: 기존 영지가 있으면 "계속하기/새로 만들기" 선택, 없으면 바로 새 영지 생성 흐름
  afterLogin: () =>
    void show(async () => {
      const servers = await api.servers();
      return servers.some((s) => s.hasCharacter) ? modeScreen(nav) : serverScreen(nav, 'new');
    }),
};

void registerServiceWorker();
if (LOCAL) {
  // 혼자 하는 웹판: 로그인/서버 선택 없이 바로 내 영지로 (없으면 종족 선택부터)
  const localStart = (): void =>
    void show(async () => {
      const servers = await api.servers();
      const s = servers.find((x) => x.id === 1) ?? servers[0];
      if (s.hasCharacter) return territoryScreen(await api.me(s.id));
      return raceScreen(nav, s);
    });
  nav.toTitle = localStart;
  nav.toMode = localStart;
  nav.toServers = localStart;
  nav.afterLogin = localStart;
  mount(root, h('div', { class: 'screen' }, t('common.loading')));
  bootLocal()
    .then(localStart)
    .catch((e) => {
      console.error(e);
      mount(
        root,
        h(
          'div',
          { class: 'screen' },
          h('div', { class: 'error' }, '시작하지 못했습니다: ' + String(e)),
        ),
      );
    });
} else if (session.token) nav.afterLogin();
else nav.toTitle();
