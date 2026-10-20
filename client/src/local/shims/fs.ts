/** 브라우저용 `node:fs` 대체: data/*.json 을 빌드 때 묶어 두고 readFileSync 로 꺼내 준다. */
const files = import.meta.glob('../../../../data/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const byName = new Map<string, string>();
for (const [path, text] of Object.entries(files)) byName.set(path.split('/').pop()!, text);

export function readFileSync(path: string, _enc?: string): string {
  const name = String(path).split('/').pop()!;
  const text = byName.get(name);
  if (text === undefined) throw new Error(`데이터 파일을 찾을 수 없습니다: ${name}`);
  return text;
}

export function existsSync(): boolean {
  return false;
}
