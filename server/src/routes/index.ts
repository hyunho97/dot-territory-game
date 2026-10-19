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
import {
  FailLimiter,
  hashPassword,
  normalizeLoginId,
  validPassword,
  verifyPassword,
} from '../services/authRules.js';
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

const SESSION_DAYS = 30;
const DUMMY = hashPassword('dummy-password-for-timing');

function requireUser(req: FastifyRequest): number {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const row = token
    ? (db
        .prepare('SELECT user_id AS id FROM sessions WHERE token = ? AND expires_at > ?')
        .get(token, Date.now()) as { id: number } | undefined)
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

  // ── ID/비밀번호 계정 ──
  const loginLimiter = new FailLimiter(5, 10 * 60_000);
  const registerLimiter = new FailLimiter(10, 60 * 60_000); // IP 당 시간당 가입 수
  const newSession = (userId: number): string => {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    ).run(token, userId, now, now + SESSION_DAYS * 86_400_000);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    return token;
  };

  app.post('/api/auth/register', async (req) => {
    if (registerLimiter.blocked(req.ip)) throw new GameError('TOO_MANY_ATTEMPTS', 429);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const loginId = normalizeLoginId(body.loginId);
    if (!loginId) throw new GameError('INVALID_LOGIN_ID');
    if (!validPassword(body.password)) throw new GameError('INVALID_PASSWORD');
    if (typeof body.nickname !== 'string') throw new GameError('INVALID_NICKNAME');
    const nick = body.nickname.trim();
    const { min, max } = gameConfig.nickname;
    if (nick.length < min || nick.length > max) throw new GameError('INVALID_NICKNAME');
    if (db.prepare('SELECT 1 FROM users WHERE login_id = ?').get(loginId))
      throw new GameError('LOGIN_ID_TAKEN', 409);
    if (db.prepare('SELECT 1 FROM users WHERE nickname = ?').get(nick))
      throw new GameError('NICKNAME_TAKEN', 409);
    const { salt, hash } = hashPassword(body.password);
    registerLimiter.fail(req.ip); // 성공한 가입도 횟수에 포함
    const info = db
      .prepare(
        'INSERT INTO users (nickname, token, login_id, pw_hash, pw_salt, created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(nick, randomBytes(24).toString('hex'), loginId, hash, salt, Date.now());
    return { nickname: nick, token: newSession(Number(info.lastInsertRowid)) };
  });

  app.post('/api/auth/login', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const loginId = normalizeLoginId(body.loginId);
    const key = `${loginId ?? '?'}|${req.ip}`;
    if (loginLimiter.blocked(key)) throw new GameError('TOO_MANY_ATTEMPTS', 429);
    const user = loginId
      ? (db
          .prepare('SELECT id, nickname, pw_hash, pw_salt FROM users WHERE login_id = ?')
          .get(loginId) as
          { id: number; nickname: string; pw_hash: string; pw_salt: string } | undefined)
      : undefined;
    const password = typeof body.password === 'string' ? body.password : '';
    // 존재하지 않는 ID 도 같은 비용의 해시 계산을 해서 응답 시간 차이로 ID 존재 여부가 드러나지 않게 한다
    const ok = user
      ? verifyPassword(password, user.pw_salt, user.pw_hash)
      : (verifyPassword(password, DUMMY.salt, DUMMY.hash), false);
    if (!user || !ok) {
      loginLimiter.fail(key);
      throw new GameError('INVALID_CREDENTIALS');
    }
    loginLimiter.reset(key);
    return { nickname: user.nickname, token: newSession(user.id) };
  });

  app.post('/api/auth/logout', async (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return { ok: true };
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
