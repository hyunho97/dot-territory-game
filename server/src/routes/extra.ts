import type { FastifyInstance, FastifyRequest } from 'fastify';
import { exchange, marketState } from '../services/marketService.js';
import { GameError } from '../services/territoryService.js';
import { claimAttendance, claimQuest, getQuests } from '../services/questService.js';
import { recordEvent } from '../services/questEvents.js';
import { ranking } from '../services/rankingService.js';
import type { RankType } from '../services/rankingService.js';
import { researchState, startResearch } from '../services/researchService.js';
import { enterSession } from '../services/sessionService.js';
import { useSpeedup } from '../services/speedupService.js';
import type { SpeedupTarget } from '../services/speedupService.js';

interface Helpers {
  requireUser: (req: FastifyRequest) => number;
  characterIdOf: (userId: number, serverId: number) => number;
}

/** 퀘스트/출석, 접속 리포트, 교역소, 연구소, 랭킹 */
export function registerExtraRoutes(app: FastifyInstance, h: Helpers): void {
  const cidFromQuery = (req: FastifyRequest): number =>
    h.characterIdOf(h.requireUser(req), Number((req.query as { server?: string }).server));
  const cidFromBody = (req: FastifyRequest): { cid: number; body: Record<string, unknown> } => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return { cid: h.characterIdOf(h.requireUser(req), Number(body.server)), body };
  };

  app.post('/api/session/enter', async (req) => {
    const { cid } = cidFromBody(req);
    return { report: enterSession(cid) };
  });

  app.get('/api/quests', async (req) => getQuests(cidFromQuery(req)));
  app.post('/api/quests/claim', async (req) => {
    const { cid, body } = cidFromBody(req);
    const summary = claimQuest(cid, String(body.questId ?? ''));
    return { summary, quests: getQuests(cid) };
  });
  app.post('/api/attendance/claim', async (req) => {
    const { cid } = cidFromBody(req);
    const summary = claimAttendance(cid);
    return { summary, quests: getQuests(cid) };
  });

  app.post('/api/speedup', async (req) => {
    const { cid, body } = cidFromBody(req);
    const target = String(body.target ?? '') as SpeedupTarget;
    if (!['levelup', 'building', 'research'].includes(target))
      throw new GameError('INVALID_TARGET');
    return useSpeedup(cid, target, Number(body.seconds), Number(body.buildingId));
  });

  app.get('/api/market', async (req) => marketState(cidFromQuery(req)));
  app.post('/api/market/exchange', async (req) => {
    const { cid, body } = cidFromBody(req);
    const result = exchange(
      cid,
      String(body.from ?? ''),
      String(body.to ?? ''),
      Number(body.amount),
    );
    recordEvent(cid, 'exchange');
    return { result, market: marketState(cid) };
  });

  app.get('/api/research', async (req) => researchState(cidFromQuery(req)));
  app.post('/api/research/start', async (req) => {
    const { cid, body } = cidFromBody(req);
    startResearch(cid, String(body.techId ?? ''));
    recordEvent(cid, 'research');
    return researchState(cid);
  });

  app.get('/api/ranking', async (req) => {
    const type = ((req.query as { type?: string }).type === 'level' ? 'level' : 'cp') as RankType;
    return ranking(cidFromQuery(req), type);
  });
}
