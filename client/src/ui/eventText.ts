import { t } from '../i18n';

export interface GameEvent {
  key: string;
  params: Record<string, unknown>;
  at?: number;
}

const resList = (r: Record<string, number>): string =>
  Object.entries(r)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${t(`resource.${k}`)} +${v}`)
    .join(', ') || '-';

const equipName = (e: { type: string; grade: string }): string =>
  `${t(`equip.grade.${e.grade}`)} ${t(`equip.type.${e.type}`)}`;

/** 서버 이벤트 로그 -> 한국어 문장 (하단 알림 바와 접속 리포트에서 공용) */
export function describeEvent(ev: GameEvent): string {
  const p = ev.params as Record<string, never>;
  switch (ev.key) {
    case 'expeditionDone': {
      let text = t('event.expeditionDone', {
        resource: t(`resource.${p.resource}`),
        amount: p.amount,
      });
      const kind = p.event as string | null;
      if (kind === 'bonus_cache') text += ` · ${t('event.exp.bonus_cache')}`;
      else if (kind === 'treasure') text += ` · ${t('event.exp.treasure', { gold: p.gold })}`;
      else if (kind === 'equipment_find' && p.equipment)
        text += ` · ${t('event.exp.equipment_find', { name: equipName(p.equipment as { type: string; grade: string }) })}`;
      else if (kind === 'speedup_find')
        text += ` · ${t('event.exp.speedup_find', { n: p.speedupMin })}`;
      else if (kind === 'ambush') text += ` · ${t('event.exp.ambush', { lost: p.lost })}`;
      return text;
    }
    case 'trainDone':
      return t('event.trainDone', { unit: t(`unit.${p.unit}`), amount: p.amount });
    case 'craftDone':
      return t('event.craftDone', {
        name: equipName(p as unknown as { type: string; grade: string }),
        power: p.power,
      });
    case 'buildingUpgraded':
      return t('event.buildingUpgraded', { name: t(`building.${p.type}`), level: p.level });
    case 'levelUp':
      return t('event.levelUp', { level: p.level });
    case 'researchDone':
      return t('event.researchDone', { tech: t(`research.tech.${p.tech}`), level: p.level });
    case 'raid': {
      const raider = String(p.raiderCP);
      if (p.winner === 'player')
        return t('event.raidPlayer', {
          raider,
          reward:
            resList(p.reward as Record<string, number>) +
            (p.speedupMin ? `, ${t('quest.speedup', { n: p.speedupMin })}` : ''),
          lost: p.lost,
        });
      if (p.winner === 'raiders')
        return t('event.raidRaiders', {
          raider,
          plunder: resList(p.plunder as Record<string, number>),
          lost: p.lost,
        });
      return t('event.raidDraw', { raider, lost: p.lost });
    }
    case 'dungeonDone':
      return t('event.dungeonDone', { n: p.cleared });
    case 'battleDone':
      return t('battle.logBattle', {
        result: t(`battle.result.${p.winner === 'A' ? 'win' : p.winner === 'B' ? 'lose' : 'draw'}`),
        stage: t(`stage.${p.stage}`),
      });
    case 'pvpAttack':
      return t('pvp.logAttack', {
        result: t(`battle.result.${p.winner === 'A' ? 'win' : p.winner === 'B' ? 'lose' : 'draw'}`),
        target: String(p.target),
      });
    case 'pvpDefended':
      return t('pvp.logDefended', {
        attacker: String(p.attacker),
        result: t(
          p.winner === 'B'
            ? 'pvp.defendWin'
            : p.winner === 'A'
              ? 'pvp.defendLose'
              : 'pvp.defendDraw',
        ),
        lost: p.lost,
      });
    default:
      return ev.key;
  }
}
