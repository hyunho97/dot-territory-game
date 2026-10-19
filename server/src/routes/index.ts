import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/db.js';
import { gameConfig, serversData, staticData } from '../data.js';
import { GameError, createCharacter, getCharacter } from '../services/characterService.js';
import {
  craftEquipment,
  equipItem,
  equipmentState,
  salvageItem,
  unequipItem,
} from '../services/equipmentService.js';
import { pvpAttack, pvpTargets } from '../services/pvpService.js';
import { recordEvent } from '../services/questEvents.js';
import { touchSeen } from '../services/sessionService.js';
import { registerExtraRoutes } from './extra.js';
import { battleHistory, stageList, startPveBattle } from '../services/battleService.js';
import {
  build,
  upgradeBuilding,
  exploreState,
  sendExpedition,
  startLevelUp,
  trainUnits,
} from '../services/territoryService.js';

type UserRow = { id: number; nickname: string; token: string };

function requireUser(req: FastifyRequest): number {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const row = token
    ? (db.prepare('SELECT id FROM users WHERE token = ?').get(token) as { id: number } | undefined)
    : undefined;
  if (!row) throw new GameError('UNAUTHORIZED', 401);
  return row.id;
}

export function registerRoutes(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) return reply.status(err.status).send({ error: err.code });
    app.log.error(err);
    return reply.status(500).send({ error: 'INTERNAL' });
  });

  // 닉네임 기반 임시 로그인 (초기 단계: 비밀번호 없음. 같은 닉네임이면 같은 계정으로 재접속)
  app.post('/api/auth/guest', async (req) => {
    const { nickname } = (req.body ?? {}) as { nickname?: string };
    if (typeof nickname !== 'string') throw new GameError('INVALID_NICKNAME');
    const nick = nickname.trim();
    const { min, max } = gameConfig.nickname;
    if (nick.length < min || nick.length > max) throw new GameError('INVALID_NICKNAME');
    const find = db.prepare('SELECT id, nickname, token FROM users WHERE nickname = ?');
    let user = find.get(nick) as UserRow | undefined;
    if (!user) {
      const token = randomBytes(24).toString('hex');
      db.prepare('INSERT INTO users (nickname, token, created_at) VALUES (?,?,?)').run(
        nick,
        token,
        Date.now(),
      );
      user = find.get(nick) as UserRow;
    }
    return { nickname: user.nickname, token: user.token };
  });

  app.get('/api/servers', async (req) => {
    const userId = requireUser(req);
    const { normalMax, busyMax } = serversData.congestion;
    const counts = db
      .prepare('SELECT server_id, COUNT(*) AS n FROM characters GROUP BY server_id')
      .all() as unknown as { server_id: number; n: number }[];
    const mine = db
      .prepare(
        'SELECT server_id, race, territory_name AS name, territory_level AS level FROM characters WHERE user_id = ?',
      )
      .all(userId) as unknown as {
      server_id: number;
      race: string;
      name: string;
      level: number;
    }[];
    return serversData.servers.map((s) => {
      const n = counts.find((c) => c.server_id === s.id)?.n ?? 0;
      const status = n <= normalMax ? 'smooth' : n <= busyMax ? 'normal' : 'busy';
      const my = mine.find((m) => m.server_id === s.id);
      return {
        id: s.id,
        name: s.name,
        status,
        hasCharacter: !!my,
        myRace: my?.race ?? null,
        myTerritoryName: my?.name ?? null,
        myLevel: my?.level ?? null,
      };
    });
  });

  app.post('/api/servers/:id/character', async (req, reply) => {
    const userId = requireUser(req);
    const serverId = Number((req.params as { id: string }).id);
    const { race, territoryName } = (req.body ?? {}) as { race?: string; territoryName?: string };
    const ch = createCharacter(userId, serverId, race ?? '', territoryName ?? '');
    return reply.status(201).send(ch);
  });

  app.get('/api/character/me', async (req) => {
    const userId = requireUser(req);
    const serverId = Number((req.query as { server?: string }).server);
    const ch = getCharacter(userId, serverId);
    if (!ch) throw new GameError('NO_CHARACTER', 404);
    if ((req.query as { touch?: string }).touch) touchSeen(ch.id); // 접속 중 하트비트
    return ch;
  });

  function characterIdOf(userId: number, serverId: number): number {
    const row = db
      .prepare('SELECT id FROM characters WHERE user_id = ? AND server_id = ?')
      .get(userId, serverId) as { id: number } | undefined;
    if (!row) throw new GameError('NO_CHARACTER', 404);
    return row.id;
  }

  app.post('/api/building/build', async (req) => {
    const userId = requireUser(req);
    const { server, type } = (req.body ?? {}) as { server?: number; type?: string };
    const cid = characterIdOf(userId, Number(server));
    build(cid, String(type ?? ''));
    recordEvent(cid, 'build', 1, String(type ?? ''));
    return getCharacter(userId, Number(server));
  });

  app.post('/api/building/upgrade', async (req) => {
    const userId = requireUser(req);
    const { server, buildingId } = (req.body ?? {}) as { server?: number; buildingId?: number };
    const cid = characterIdOf(userId, Number(server));
    upgradeBuilding(cid, Number(buildingId));
    recordEvent(cid, 'upgrade');
    return getCharacter(userId, Number(server));
  });

  app.post('/api/territory/levelup', async (req) => {
    const userId = requireUser(req);
    const { server } = (req.body ?? {}) as { server?: number };
    startLevelUp(characterIdOf(userId, Number(server)));
    return getCharacter(userId, Number(server));
  });

  app.post('/api/units/train', async (req) => {
    const userId = requireUser(req);
    const { server, unitId, amount } = (req.body ?? {}) as {
      server?: number;
      unitId?: string;
      amount?: number;
    };
    const cid = characterIdOf(userId, Number(server));
    trainUnits(cid, String(unitId ?? ''), Number(amount));
    recordEvent(cid, 'train', Number(amount));
    return getCharacter(userId, Number(server));
  });

  app.get('/api/battle/stages', async (req) => {
    const userId = requireUser(req);
    const serverId = Number((req.query as { server?: string }).server);
    return stageList(characterIdOf(userId, serverId));
  });

  app.post('/api/battle/start', async (req) => {
    const userId = requireUser(req);
    const { server, stageId, units } = (req.body ?? {}) as {
      server?: number;
      stageId?: string;
      units?: Record<string, number>;
    };
    const cid = characterIdOf(userId, Number(server));
    const result = startPveBattle(cid, String(stageId ?? ''), units ?? {});
    if (result.winner === 'A') recordEvent(cid, 'pveWin');
    return result;
  });

  app.get('/api/pvp/targets', async (req) => {
    const userId = requireUser(req);
    const serverId = Number((req.query as { server?: string }).server);
    return pvpTargets(characterIdOf(userId, serverId));
  });

  app.post('/api/pvp/attack', async (req) => {
    const userId = requireUser(req);
    const { server, targetId, units } = (req.body ?? {}) as {
      server?: number;
      targetId?: number;
      units?: Record<string, number>;
    };
    const cid = characterIdOf(userId, Number(server));
    const result = pvpAttack(cid, Number(targetId), units ?? {});
    recordEvent(cid, 'pvpAttack');
    return result;
  });

  app.get('/api/battle/log', async (req) => {
    const userId = requireUser(req);
    const serverId = Number((req.query as { server?: string }).server);
    return battleHistory(characterIdOf(userId, serverId));
  });

  app.get('/api/equipment', async (req) => {
    const userId = requireUser(req);
    const serverId = Number((req.query as { server?: string }).server);
    return equipmentState(characterIdOf(userId, serverId));
  });

  app.post('/api/smithy/craft', async (req) => {
    const userId = requireUser(req);
    const { server, type } = (req.body ?? {}) as { server?: number; type?: string };
    const cid = characterIdOf(userId, Number(server));
    craftEquipment(cid, String(type ?? ''));
    recordEvent(cid, 'craft');
    return equipmentState(cid);
  });

  app.post('/api/equipment/:action', async (req) => {
    const userId = requireUser(req);
    const action = (req.params as { action: string }).action;
    const { server, itemId } = (req.body ?? {}) as { server?: number; itemId?: number };
    const cid = characterIdOf(userId, Number(server));
    if (action === 'equip') {
      equipItem(cid, Number(itemId));
      recordEvent(cid, 'equip');
    } else if (action === 'unequip') unequipItem(cid, Number(itemId));
    else if (action === 'salvage') salvageItem(cid, Number(itemId));
    else throw new GameError('NOT_FOUND', 404);
    return equipmentState(cid);
  });

  app.get('/api/explore', async (req) => {
    const userId = requireUser(req);
    const serverId = Number((req.query as { server?: string }).server);
    return exploreState(characterIdOf(userId, serverId));
  });

  app.post('/api/explore/send', async (req) => {
    const userId = requireUser(req);
    const { server, nodeId, troops } = (req.body ?? {}) as {
      server?: number;
      nodeId?: number;
      troops?: number;
    };
    const cid = characterIdOf(userId, Number(server));
    sendExpedition(cid, Number(nodeId), Number(troops));
    recordEvent(cid, 'expedition');
    return exploreState(cid);
  });

  app.get('/api/data/:name', async (req) => {
    const name = (req.params as { name: string }).name;
    const d = Object.hasOwn(staticData, name) ? staticData[name] : undefined;
    if (!d) throw new GameError('NOT_FOUND', 404);
    return d;
  });

  registerExtraRoutes(app, { requireUser, characterIdOf });
}
