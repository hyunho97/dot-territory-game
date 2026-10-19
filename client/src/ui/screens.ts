import { ApiError, api, loadManifest, session } from '../api/client';
import type { CharacterState, RaceData, ServerInfo, UnitData } from '../api/client';
import { errorMessage, t } from '../i18n';
import { h } from './dom';
import { iconEl } from './icons';

export interface Nav {
  toTitle(): void;
  toServers(mode: 'new' | 'continue'): void;
  toMode(): void;
  afterLogin(): void;
  toRace(server: ServerInfo): void;
  toTerritory(ch: CharacterState): void;
}

/** 에셋 매니페스트에 있으면 도트 이미지, 없으면 플레이스홀더 */
async function spriteEl(spriteId: string, label: string): Promise<HTMLElement> {
  const manifest = await loadManifest();
  const path = manifest[spriteId];
  if (path) return h('img', { src: `/${path}`, alt: label, width: 96, height: 96 });
  return h('div', { class: 'placeholder-sprite' }, label);
}

function msg(e: unknown): string {
  return errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN');
}

export async function titleScreen(nav: Nav): Promise<HTMLElement> {
  const err = h('div', { class: 'error' });
  let registering = false;
  const idInput = h('input', {
    class: 'input',
    placeholder: t('title.loginIdPlaceholder'),
    maxlength: 20,
    autocomplete: 'username',
    value: session.loginId ?? '',
  }) as HTMLInputElement;
  const pwInput = h('input', {
    class: 'input',
    type: 'password',
    placeholder: t('title.passwordPlaceholder'),
    maxlength: 64,
    autocomplete: 'current-password',
  }) as HTMLInputElement;
  const nickInput = h('input', {
    class: 'input',
    placeholder: t('title.nicknamePlaceholder'),
    maxlength: 12,
  }) as HTMLInputElement;
  const nickRow = h(
    'div',
    { class: 'title-nick', style: 'display:none' },
    h('label', {}, t('title.nickname')),
    nickInput,
  );
  const submitBtn = h('button', { class: 'btn primary' }, t('title.login'));
  const switchBtn = h('button', { class: 'btn' }, t('title.toRegister'));
  const hint = h('div', { class: 'muted' }, t('title.hint'));

  const applyMode = () => {
    nickRow.style.display = registering ? '' : 'none';
    submitBtn.textContent = registering ? t('title.register') : t('title.login');
    switchBtn.textContent = registering ? t('title.toLogin') : t('title.toRegister');
    pwInput.autocomplete = registering ? 'new-password' : 'current-password';
    hint.textContent = registering ? t('title.registerHint') : t('title.hint');
    err.textContent = '';
  };
  const submit = async () => {
    err.textContent = '';
    (submitBtn as HTMLButtonElement).disabled = true;
    try {
      const r = registering
        ? await api.register(idInput.value, pwInput.value, nickInput.value)
        : await api.login(idInput.value, pwInput.value);
      session.set(r.token, r.nickname, idInput.value.trim().toLowerCase());
      nav.afterLogin();
    } catch (e) {
      err.textContent = msg(e);
    } finally {
      (submitBtn as HTMLButtonElement).disabled = false;
    }
  };
  submitBtn.addEventListener('click', () => void submit());
  switchBtn.addEventListener('click', () => {
    registering = !registering;
    applyMode();
  });
  for (const el of [idInput, pwInput, nickInput])
    el.addEventListener('keydown', (ev) => ev.key === 'Enter' && void submit());

  const sprites = h('div', { class: 'title-sprites' });
  for (const [id, label] of [
    ['units/human_warrior', ''],
    ['units/human_mage', ''],
    ['units/undead_skeleton', ''],
    ['units/red_dragon', ''],
  ])
    sprites.append(await spriteEl(id, label));

  return h(
    'div',
    { class: 'screen' },
    sprites,
    h('h1', { class: 'title-logo' }, t('app.title')),
    h('p', { class: 'title-sub' }, t('app.subtitle')),
    h(
      'div',
      { class: 'title-form panel' },
      h('label', {}, t('title.loginId')),
      idInput,
      h('label', {}, t('title.password')),
      pwInput,
      nickRow,
      submitBtn,
      switchBtn,
      err,
      hint,
    ),
  );
}

export async function modeScreen(nav: Nav): Promise<HTMLElement> {
  const servers = await api.servers();
  const hasAny = servers.some((s) => s.hasCharacter);
  const allTaken = servers.every((s) => s.hasCharacter);
  const card = (title: string, hint: string, disabled: boolean, onclick: () => void) =>
    h(
      'button',
      { class: 'btn mode-btn', disabled, onclick },
      h('div', { class: 'mode-title' }, title),
      h('div', { class: 'muted' }, hint),
    );
  return h(
    'div',
    { class: 'screen' },
    h('h1', {}, `${t('mode.heading')} — ${session.nickname ?? ''}`),
    h(
      'div',
      { class: 'row mode-row' },
      card(t('mode.continue'), t('mode.continueHint'), !hasAny, () => nav.toServers('continue')),
      card(t('mode.new'), allTaken ? t('mode.allTaken') : t('mode.newHint'), allTaken, () =>
        nav.toServers('new'),
      ),
    ),
    h(
      'button',
      {
        class: 'btn',
        onclick: () => {
          void api.logout().catch(() => undefined);
          session.clear();
          nav.toTitle();
        },
      },
      t('mode.logout'),
    ),
  );
}

export async function serverScreen(nav: Nav, mode: 'new' | 'continue'): Promise<HTMLElement> {
  const err = h('div', { class: 'error' });
  const all = await api.servers();
  const servers = mode === 'continue' ? all.filter((s) => s.hasCharacter) : all;
  let selected: ServerInfo | null = null;
  const startBtn = h('button', { class: 'btn primary', disabled: true }, t('common.start'));
  const list = h('div', { class: 'server-list' });
  const cards: HTMLElement[] = [];

  if (servers.length === 0) list.append(h('div', { class: 'muted' }, t('server.noneToContinue')));
  for (const s of servers) {
    const taken = mode === 'new' && s.hasCharacter;
    const card = h(
      'div',
      {
        class: `panel server-card${taken ? ' disabled' : ''}`,
        onclick: () => {
          if (taken) return;
          selected = s;
          cards.forEach((c) => c.classList.remove('selected'));
          card.classList.add('selected');
          (startBtn as HTMLButtonElement).disabled = false;
        },
      },
      h('div', { class: 'name' }, s.name),
      h(
        'div',
        { class: 'row', style: 'justify-content:flex-start' },
        h('span', { class: `badge ${s.status}` }, t(`server.status.${s.status}`)),
        taken ? h('span', { class: 'badge mine' }, t('server.taken')) : null,
      ),
      mode === 'continue' && s.myRace
        ? h(
            'div',
            { class: 'muted' },
            t('server.myTerritory', {
              name: s.myTerritoryName ?? '',
              level: s.myLevel ?? 1,
              race: t(`race.${s.myRace}.name`),
            }),
          )
        : null,
    );
    cards.push(card);
    list.append(card);
  }

  startBtn.addEventListener('click', async () => {
    if (!selected) return;
    err.textContent = '';
    if (mode === 'continue') {
      try {
        nav.toTerritory(await api.me(selected.id));
      } catch (e) {
        err.textContent = msg(e);
      }
    } else {
      nav.toRace(selected);
    }
  });

  return h(
    'div',
    { class: 'screen' },
    h('h1', {}, mode === 'new' ? t('server.headingNew') : t('server.headingContinue')),
    list,
    err,
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn', onclick: () => nav.toMode() }, t('common.back')),
      startBtn,
    ),
  );
}

function fmtMod(v: number): HTMLElement {
  const pct = Math.round((v - 1) * 100);
  const text = pct === 0 ? '±0%' : `${pct > 0 ? '+' : ''}${pct}%`;
  return h('span', { class: pct > 0 ? 'mod-up' : pct < 0 ? 'mod-down' : 'muted' }, text);
}

export async function raceScreen(nav: Nav, server: ServerInfo): Promise<HTMLElement> {
  const err = h('div', { class: 'error' });
  const [{ races }, { units }] = await Promise.all([api.races(), api.units()]);
  const manifest = await loadManifest();
  const enabled = races.filter((r) => r.enabled);
  let selected: RaceData | null = null;

  const detail = h(
    'div',
    { class: 'panel detail' },
    h('div', { class: 'muted' }, t('race.select')),
  );
  const cardsEl = h('div', { class: 'race-cards' });
  const cardEls = new Map<string, HTMLElement>();

  const showDetail = async (race: RaceData) => {
    const unit: UnitData | undefined = units.find((u) => u.id === race.startUnit);
    const m = race.mods;
    const modRows = (['combatPower', 'resourceGain', 'trainSpeed', 'costRate'] as const).map((k) =>
      h('li', {}, `${t(`race.modLabels.${k}`)} `, fmtMod(m[k])),
    );
    for (const [cls, v] of Object.entries(m.classPower))
      modRows.push(h('li', {}, `${t(`race.classPower.${cls}`)} `, fmtMod(v)));
    modRows.push(h('li', {}, t(`race.equipGrade.${m.equipGrade}`)));

    const nameInput = h('input', {
      class: 'input',
      placeholder: t('race.territoryPlaceholder'),
      maxlength: 12,
    });
    const createBtn = h('button', { class: 'btn primary' }, t('race.create'));
    createBtn.addEventListener('click', async () => {
      err.textContent = '';
      (createBtn as HTMLButtonElement).disabled = true;
      try {
        nav.toTerritory(await api.createCharacter(server.id, race.id, nameInput.value));
      } catch (e) {
        err.textContent = msg(e);
        (createBtn as HTMLButtonElement).disabled = false;
      }
    });

    const unitName = unit ? t(`unit.${unit.id}`) : '';
    const preview = unit ? await spriteEl(unit.sprite, unitName) : h('div');
    detail.replaceChildren(
      manifest[`races/${race.id}`]
        ? h('img', { class: 'race-banner', src: `/${manifest[`races/${race.id}`]}`, alt: '' })
        : h('div'),
      h(
        'h2',
        {},
        iconEl(`emblems/${race.id}`, 32, manifest) ?? '',
        ` ${t(`race.${race.id}.name`)}`,
      ),
      h('p', {}, t(`race.${race.id}.desc`)),
      h('div', { class: 'pro' }, `▲ ${t('race.pros')}: ${t(`race.${race.id}.pros`)}`),
      h('div', { class: 'con' }, `▼ ${t('race.cons')}: ${t(`race.${race.id}.cons`)}`),
      h('h3', { style: 'margin-top:12px' }, t('race.mods')),
      h('ul', {}, ...modRows),
      h('h3', {}, t('race.startUnit')),
      h('div', { class: 'unitprev' }, preview, h('span', {}, unitName)),
      h('div', { class: 'muted', style: 'margin-bottom:10px' }, t('race.permanent')),
      h('label', {}, t('race.territoryName')),
      nameInput,
      h('div', { style: 'height:10px' }),
      createBtn,
    );
  };

  for (const race of enabled) {
    const unit = units.find((u) => u.id === race.startUnit);
    const card = h(
      'div',
      {
        class: 'panel race-card',
        onclick: () => {
          selected = race;
          cardEls.forEach((c) => c.classList.remove('selected'));
          card.classList.add('selected');
          void showDetail(race);
        },
      },
      h(
        'div',
        { class: 'portrait', style: `border-bottom:4px solid ${race.theme[1]}` },
        unit ? await spriteEl(unit.sprite, t(`unit.${unit.id}`)) : null,
      ),
      h(
        'div',
        { class: 'rname', style: `color:${race.theme[0]}` },
        iconEl(`emblems/${race.id}`, 22, manifest) ?? '',
        ` ${t(`race.${race.id}.name`)}`,
      ),
      h('div', { class: 'rsum' }, t(`race.${race.id}.summary`)),
    );
    cardEls.set(race.id, card);
    cardsEl.append(card);
  }
  void selected;

  return h(
    'div',
    { class: 'screen' },
    h('h1', {}, `${t('race.heading')} — ${server.name}`),
    h('div', { class: 'race-layout' }, cardsEl, detail),
    err,
    h('button', { class: 'btn', onclick: () => nav.toServers('new') }, t('common.back')),
  );
}
