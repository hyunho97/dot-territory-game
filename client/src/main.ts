import './style.css';
import type Phaser from 'phaser';
import { ApiError, api, loadManifest, session } from './api/client';
import type { CharacterState, ServerInfo } from './api/client';
import { errorMessage, t } from './i18n';
import { h, mount } from './ui/dom';
import { describeEvent } from './ui/eventText';
import { RES_COLORS, closeAllModals, openBuildingPanel, openExplorePanel } from './ui/panels';
import type { PanelCtx } from './ui/panels';
import { openBarracksPanel } from './ui/barracks';
import { openBattlePanel } from './ui/battle';
import { openMarketPanel } from './ui/market';
import { openQuestPanel, hasClaimable } from './ui/quests';
import { iconEl } from './ui/icons';
import { openDungeonPanel } from './ui/dungeon';
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
  const sceneInit = () => ({
    character: ch,
    buildingData: buildings,
    units,
    manifest,
    spriteTiers,
    onBuildingClick: (type: string) => openBuildingPanel(ctx, type),
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
  let questBadge = false; // 받을 수 있는 퀘스트/출석 보상이 있는지

  const actionBtn = (label: string, onclick: () => void, extra = '', icon?: string): HTMLElement =>
    h(
      'button',
      { class: `btn primary${extra}`, onclick },
      (icon && iconEl(icon, 16, manifest)) || '',
      label,
    );

  const renderTop = () => {
    const info: HTMLElement[] = [
      iconEl(`emblems/${ch.race}`, 22, manifest) ?? h('span'),
      h('strong', {}, ch.territoryName),
      h('span', { class: 'lvl' }, t('territory.level', { n: ch.territoryLevel })),
      clockEl,
      workerEl,
    ];
    for (const [k, v] of Object.entries(ch.resources)) {
      info.push(
        h(
          'span',
          { class: 'res' },
          iconEl(`icons/res_${k}`, 16, manifest) ??
            h('span', { class: 'swatch', style: `background:${RES_COLORS[k]}` }),
          `${t(`resource.${k}`)} ${v}`,
        ),
      );
    }
    info.push(
      h('span', { class: 'muted' }, t('territory.storage', { n: ch.storageCap })),
      h('span', { class: 'spacer' }),
      h('span', {}, t('territory.troopsFmt', { n: ch.totalTroops, max: ch.maxTroops })),
      h('span', {}, `${t('territory.cp')} ${ch.totalCP}`),
    );
    const actions = h(
      'div',
      { class: 'actions' },
      actionBtn(
        t('territory.tabTerritory'),
        () => openBuildingPanel(ctx),
        '',
        'icons/nav_territory',
      ),
      actionBtn(t('territory.tabBarracks'), () => openBarracksPanel(ctx), '', 'icons/nav_barracks'),
      actionBtn(t('territory.tabSmithy'), () => openSmithyPanel(ctx), '', 'icons/nav_smithy'),
      actionBtn(t('territory.tabBattle'), () => openBattlePanel(ctx), '', 'icons/nav_battle'),
      actionBtn(t('territory.tabExplore'), () => openExplorePanel(ctx), '', 'icons/nav_explore'),
      actionBtn(t('territory.tabMarket'), () => openMarketPanel(ctx), '', 'icons/trade'),
      actionBtn(t('territory.tabDungeon'), () => openDungeonPanel(ctx), '', 'icons/nav_dungeon'),
      actionBtn(t('territory.tabGuild'), () => openGuildPanel(ctx), '', 'icons/nav_guild'),
      actionBtn(t('territory.tabResearch'), () => openResearchPanel(ctx), '', 'icons/research'),
      actionBtn(t('territory.tabRanking'), () => openRankingPanel(ctx), '', 'icons/ranking'),
      h(
        'button',
        {
          class: `btn primary${questBadge ? ' badge-on' : ''}`,
          onclick: () =>
            openQuestPanel(ctx, (q) => {
              questBadge = hasClaimable(q);
              renderTop();
            }),
        },
        iconEl('icons/quest', 16, manifest) ?? '',
        t('territory.tabQuest'),
        questBadge ? (iconEl('icons/quest_badge', 18, manifest) ?? '') : '',
      ),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => nav.toMode() }, t('territory.logout')),
    );
    topbar.replaceChildren(h('div', { class: 'info' }, ...info), actions);
    clockOffset = ch.serverNow - Date.now();
    tickClock();
    const last = ch.logs[0];
    logBar.textContent = last ? describeEvent(last) : t('territory.logIdle');
  };

  const ctx: PanelCtx = {
    getChar: () => ch,
    refresh: async () => {
      const sig = (c: CharacterState) =>
        JSON.stringify([c.territoryLevel, c.buildings.length, c.totalTroops]);
      const before = sig(ch);
      ch = withPreview(await api.me(ch.serverId, true)); // 접속 중 하트비트 포함
      renderTop();
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
        const next = hasClaimable(q);
        if (next !== questBadge) {
          questBadge = next;
          renderTop();
        }
      })
      .catch(() => undefined);

  renderTop();
  const wrap = h('div', { class: 'territory' }, topbar, gameRoot, logBar);

  // Phaser는 DOM 삽입 이후에 시작
  setTimeout(async () => {
    const { startTerritoryGame } = await import('./scenes/TerritoryScene');
    game = startTerritoryGame(gameRoot, sceneInit());
    // 입장: 자리를 비운 동안 있었던 일 요약 + 퀘스트 알림
    api
      .enterSession(ch.serverId)
      .then((r) => {
        if (r.report) openReportModal(r.report);
      })
      .catch(() => undefined);
    void refreshQuestBadge();
  }, 0);

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

if (session.token) nav.afterLogin();
else nav.toTitle();
