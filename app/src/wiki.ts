// Obsidian 風の [[記録タイトル]] リンクと、添付ファイルのアップロード
import type { Commit, ID, Project } from './types';

/** [[タイトル]] または [[タイトル|表示名]] */
export const WIKI_RE = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;

const norm = (s: string) => s.trim().toLowerCase();

export function findByTitle(p: Project, title: string): Commit | null {
  const t = norm(title);
  return Object.values(p.commits).find((c) => norm(c.title) === t) ?? null;
}

/** コードブロック・インラインコード以外の部分にだけ fn を適用 */
export function mapOutsideCode(md: string, fn: (s: string) => string): string {
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');
}

export function wikiTargets(body: string): string[] {
  const out: string[] = [];
  mapOutsideCode(body, (s) => {
    for (const m of s.matchAll(WIKI_RE)) out.push(m[1]);
    return s;
  });
  return out;
}

/** この記録を [[...]] で参照している記録 */
export function backlinks(p: Project, c: Commit): Commit[] {
  const t = norm(c.title);
  return Object.values(p.commits)
    .filter((x) => x.id !== c.id && wikiTargets(x.body).some((w) => norm(w) === t))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** タイトル変更に合わせて他の記録の [[旧タイトル]] を書き換える */
export function renameWikiLinks(p: Project, oldTitle: string, newTitle: string) {
  if (norm(oldTitle) === norm(newTitle)) return;
  const t = norm(oldTitle);
  for (const c of Object.values(p.commits)) {
    const next = mapOutsideCode(c.body, (s) =>
      s.replace(WIKI_RE, (all, target: string, alias?: string) =>
        norm(target) === t ? `[[${newTitle}${alias ? '|' + alias : ''}]]` : all,
      ),
    );
    if (next !== c.body) c.body = next;
  }
}

// ---------- 添付 ----------

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
const VIDEO_RE = /\.(mp4|webm)$/i;
export const isImagePath = (s: string) => IMAGE_RE.test(decodeURIComponent(s.split('?')[0]));
export const isVideoPath = (s: string) => VIDEO_RE.test(decodeURIComponent(s.split('?')[0]));

export async function uploadAttachment(projectId: ID, file: File): Promise<{ path: string; name: string }> {
  let name = file.name || 'file';
  // クリップボードからの貼り付けは "image.png" になるので日時を付ける
  if (/^image\.(png|jpe?g|gif|webp)$/i.test(name)) {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    name = `pasted-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${name.split('.').pop()}`;
  }
  const r = await fetch(`/api/attachments?project=${encodeURIComponent(projectId)}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `アップロードに失敗しました (${r.status})`);
  return { path: j.path as string, name };
}

export function attachmentMarkdown(path: string, name: string): string {
  const label = name.replace(/[[\]]/g, '');
  return isImagePath(path) || isVideoPath(path) ? `![${label}](${path})` : `[📎 ${label}](${path})`;
}

/** 本文中の添付ファイル数（グラフの目印用） */
export function countAttachments(body: string): number {
  return (body.match(/\]\(attachments\//g) ?? []).length;
}
