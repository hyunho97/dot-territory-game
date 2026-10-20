/**
 * Fastify 의 아주 작은 대역: 서버의 라우트 코드(registerRoutes)를 수정 없이 브라우저 안에서 그대로 실행한다.
 * 라우트가 쓰는 부분(get/post/setErrorHandler/req/reply)만 구현한다.
 */
type Handler = (req: LocalReq, reply: LocalReply) => unknown;
interface LocalReq {
  body: unknown;
  query: Record<string, string>;
  params: Record<string, string>;
  headers: Record<string, string>;
  ip: string;
}
interface LocalReply {
  status(code: number): LocalReply;
  send(payload: unknown): LocalReply;
}
interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

export class LocalApp {
  private routes: Route[] = [];
  private errorHandler: ((err: unknown, req: LocalReq, reply: LocalReply) => unknown) | null = null;
  log = { error: (..._a: unknown[]) => undefined, info: () => undefined, warn: () => undefined };

  private add(method: string, path: string, handler: Handler): void {
    const keys: string[] = [];
    const src = path.replace(/:([A-Za-z]+)/g, (_m, k: string) => {
      keys.push(k);
      return '([^/]+)';
    });
    this.routes.push({ method, regex: new RegExp(`^${src}$`), keys, handler });
  }
  get(path: string, handler: Handler): void {
    this.add('GET', path, handler);
  }
  post(path: string, handler: Handler): void {
    this.add('POST', path, handler);
  }
  setErrorHandler(fn: (err: unknown, req: LocalReq, reply: LocalReply) => unknown): void {
    this.errorHandler = fn;
  }

  async handle(
    method: string,
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: unknown }> {
    const [path, qs = ''] = url.split('?');
    const query: Record<string, string> = {};
    new URLSearchParams(qs).forEach((v, k) => (query[k] = v));
    const route = this.routes.find((r) => r.method === method && r.regex.test(path));
    if (!route) return { status: 404, data: { error: 'NOT_FOUND' } };
    const m = route.regex.exec(path)!;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const req: LocalReq = { body, query, params, headers, ip: '127.0.0.1' };
    let code = 200;
    let payload: unknown;
    let sent = false;
    const reply: LocalReply = {
      status(c) {
        code = c;
        return reply;
      },
      send(p) {
        payload = p;
        sent = true;
        return reply;
      },
    };
    try {
      const result = await route.handler(req, reply);
      if (!sent) payload = result;
    } catch (e) {
      if (!this.errorHandler) throw e;
      sent = false;
      code = 500;
      await this.errorHandler(e, req, reply);
    }
    // HTTP 처럼 JSON 으로 한 번 직렬화해서 돌려준다 (참조 공유 방지)
    return { status: code, data: JSON.parse(JSON.stringify(payload ?? {})) };
  }
}
