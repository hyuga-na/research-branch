// 文献情報（BibTeX の読み込み・書き出し・引用表記）
import type { Commit, Reference } from './types';

export const emptyRef = (): Reference => ({ key: '', type: 'article', authors: '', year: '', title: '', venue: '', doi: '', url: '' });

/** 著者・年・タイトルから BibTeX キーを作る（例: billa2026cascade） */
export function makeKey(r: Pick<Reference, 'authors' | 'year' | 'title'>): string {
  const first = r.authors.split(/\s+and\s+/i)[0] ?? '';
  // "Last, First" と "First Last" の両方に対応
  const last = (first.includes(',') ? first.split(',')[0] : first.trim().split(/\s+/).pop() ?? '')
    .normalize('NFKD').replace(/[^A-Za-z]/g, '').toLowerCase();
  const word = (r.title.toLowerCase().match(/[a-z]{4,}/g) ?? []).find((w) => !['with', 'from', 'that', 'this', 'towards', 'when', 'what', 'into'].includes(w)) ?? '';
  return `${last || 'ref'}${r.year || ''}${word}`;
}

const FIELD_RE = /(\w+)\s*=\s*(\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;

/** BibTeX のエントリ（1件）を読む。読めなければ null */
export function parseBibtex(src: string): Reference | null {
  const head = src.match(/@(\w+)\s*\{\s*([^,\s]+)\s*,/);
  if (!head) return null;
  const fields: Record<string, string> = {};
  for (const m of src.slice(head.index! + head[0].length).matchAll(FIELD_RE)) {
    fields[m[1].toLowerCase()] = (m[3] ?? m[4] ?? m[5] ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  }
  return {
    key: head[2],
    type: head[1].toLowerCase(),
    authors: fields.author ?? '',
    year: fields.year ?? '',
    title: fields.title ?? '',
    venue: fields.booktitle ?? fields.journal ?? fields.publisher ?? fields.howpublished ?? '',
    doi: fields.doi ?? '',
    url: fields.url ?? '',
  };
}

export function toBibtex(r: Reference): string {
  const venueField = r.type === 'inproceedings' ? 'booktitle' : r.type === 'article' ? 'journal' : 'howpublished';
  const lines = [
    ['author', r.authors], ['title', r.title], [venueField, r.venue], ['year', r.year], ['doi', r.doi], ['url', r.url],
  ].filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`);
  return `@${r.type || 'misc'}{${r.key || makeKey(r)},\n${lines.join(',\n')}\n}`;
}

/** 「Billa (2026)」のような短い引用 */
export function shortCite(r: Reference): string {
  const names = r.authors.split(/\s+and\s+/i).filter(Boolean).map((a) => (a.includes(',') ? a.split(',')[0] : a.trim().split(/\s+/).pop() ?? a).trim());
  const who = names.length === 0 ? '' : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} et al.`;
  return `${who}${r.year ? ` (${r.year})` : ''}`;
}

/** 参考文献リストの1行 */
export function fullCite(r: Reference): string {
  const authors = r.authors.split(/\s+and\s+/i).filter(Boolean).join(', ');
  return [authors, r.year && `(${r.year})`, r.title && `${r.title}.`, r.venue && `*${r.venue}*.`, r.doi && `doi:${r.doi}`]
    .filter(Boolean).join(' ');
}

export const hasRef = (c: Commit) => !!c.ref && !!(c.ref.title || c.ref.authors);

/** 記録の文献情報を BibTeX ファイルの中身にする（キー重複は a, b を付けて回避） */
export function bibFile(commits: Commit[]): string {
  const used = new Map<string, number>();
  const out: string[] = [];
  for (const c of commits) {
    if (!hasRef(c)) continue;
    const r = { ...c.ref! };
    let key = r.key || makeKey(r);
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    if (n > 0) key += String.fromCharCode(96 + n);
    out.push(toBibtex({ ...r, key }));
  }
  return out.join('\n\n') + '\n';
}
