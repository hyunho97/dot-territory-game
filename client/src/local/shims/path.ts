/** 브라우저용 `node:path` 대체 (join 만) */
export function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}
