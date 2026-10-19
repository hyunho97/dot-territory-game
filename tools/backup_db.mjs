/**
 * SQLite DB 백업 (서버가 켜진 상태에서도 안전): node tools/backup_db.mjs [출력 폴더]
 * 기본: server/backups/game-<날짜시각>.db , 최근 10개만 남긴다.
 * 환경 변수 DB_PATH 가 있으면 그 파일을 백업한다.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const src = process.env.DB_PATH ?? fileURLToPath(new URL('../server/game.db', import.meta.url));
const outDir = process.argv[2] ?? fileURLToPath(new URL('../server/backups/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
const out = join(outDir, `game-${stamp}.db`);

const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log('백업 완료:', out);

const files = readdirSync(outDir)
  .filter((f) => /^game-.*\.db$/.test(f))
  .sort();
for (const f of files.slice(0, Math.max(0, files.length - 10))) rmSync(join(outDir, f));
