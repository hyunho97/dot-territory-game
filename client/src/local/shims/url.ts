/** 브라우저용 `node:url` 대체 */
export function fileURLToPath(u: string | URL): string {
  return (typeof u === 'string' ? new URL(u) : u).pathname;
}
