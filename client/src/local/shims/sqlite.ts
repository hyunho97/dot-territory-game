/**
 * 브라우저용 `node:sqlite` 대체 (sql.js = WebAssembly SQLite).
 * 서버 코드가 쓰는 DatabaseSync / prepare().get/all/run / exec 만 같은 모양으로 제공한다.
 * 저장: 쓰기가 일어나면 잠시 뒤 DB 전체를 내보내 onDirty 콜백(IndexedDB 저장)에 넘긴다.
 */
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

let SQL: SqlJsStatic | null = null;
let initialBytes: Uint8Array | null = null;
let dirtyHook: ((db: Database) => void) | null = null;
let current: Database | null = null;

/** 서버 모듈을 불러오기 전에 호출 (sql.js 초기화는 비동기라 미리 끝내 둔다) */
export function setSqlJs(
  sql: SqlJsStatic,
  bytes: Uint8Array | null,
  onDirty: (db: Database) => void,
): void {
  SQL = sql;
  initialBytes = bytes;
  dirtyHook = onDirty;
}

export function currentDb(): Database | null {
  return current;
}

type Param = string | number | bigint | boolean | null | undefined | Uint8Array;
const norm = (params: Param[]): SqlValue[] =>
  params.map((p) =>
    p === undefined || p === null
      ? null
      : typeof p === 'boolean'
        ? p
          ? 1
          : 0
        : typeof p === 'bigint'
          ? Number(p)
          : p,
  );

class StatementSync {
  constructor(
    private owner: DatabaseSync,
    private sql: string,
  ) {}

  private with<T>(params: Param[], fn: (st: ReturnType<Database['prepare']>) => T): T {
    const st = this.owner.raw.prepare(this.sql);
    try {
      st.bind(norm(params));
      return fn(st);
    } finally {
      st.free();
    }
  }

  get(...params: Param[]): Record<string, unknown> | undefined {
    return this.with(params, (st) =>
      st.step() ? (st.getAsObject() as Record<string, unknown>) : undefined,
    );
  }

  all(...params: Param[]): Record<string, unknown>[] {
    return this.with(params, (st) => {
      const rows: Record<string, unknown>[] = [];
      while (st.step()) rows.push(st.getAsObject() as Record<string, unknown>);
      return rows;
    });
  }

  run(...params: Param[]): { changes: number; lastInsertRowid: number } {
    this.with(params, (st) => {
      st.step();
    });
    const raw = this.owner.raw;
    const changes = raw.getRowsModified();
    const id = raw.exec('SELECT last_insert_rowid()')[0]?.values[0][0] as number;
    this.owner.markDirty();
    return { changes, lastInsertRowid: id ?? 0 };
  }
}

export class DatabaseSync {
  raw: Database;
  private saveTimer = 0;

  constructor(_path?: string) {
    if (!SQL) throw new Error('sql.js 가 아직 초기화되지 않았습니다.');
    this.raw = initialBytes ? new SQL.Database(initialBytes) : new SQL.Database();
    current = this.raw;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
    if (!/^\s*(BEGIN|COMMIT|ROLLBACK|PRAGMA)/i.test(sql)) this.markDirty();
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this, sql);
  }

  markDirty(): void {
    if (!dirtyHook) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => dirtyHook?.(this.raw), 800);
  }

  /** 지금 바로 저장 (창을 닫기 직전 등) */
  flush(): void {
    window.clearTimeout(this.saveTimer);
    dirtyHook?.(this.raw);
  }
}
