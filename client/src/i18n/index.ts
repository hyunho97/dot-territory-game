import ko from './ko.json';

type Dict = { [k: string]: string | Dict };
const dict: Dict = ko as Dict;

/** t('server.status.smooth') / t('territory.level', { n: 3 }) */
export function t(key: string, params: Record<string, string | number> = {}): string {
  let cur: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === undefined) return key;
    cur = cur[part];
  }
  if (typeof cur !== 'string') return key;
  return cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export function errorMessage(code: string): string {
  const key = `error.${code}`;
  const msg = t(key);
  return msg === key ? t('error.UNKNOWN') : msg;
}
