import { useState } from 'react';
import type { Commit, ID, Project } from '../types';
import { daysUntil, isOpenTask, ownCommits, sortedBranches, today } from '../store';
import { milestoneProgress, sortedMilestones } from './Tasks';
import { Markdown, STATUS_LABEL, TASK_STATUS_LABEL } from './ui';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
/** ISO 時刻をローカルの YYYY-MM-DD に */
const localDay = (iso: string) => ymd(new Date(iso));
const md = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const slash = (s: string) => s.replace(/-/g, '/');

/** 本文の要点（最初の段落を短く） */
function gist(body: string, max = 140): string {
  const text = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[#>|-].*$/gm, (l) => (l.trim().startsWith('-') ? l.replace(/^\s*-\s*/, '') : ''))
    .replace(/[*_`]/g, '')
    .split(/\n\s*\n/).map((s) => s.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function buildReport(p: Project, from: string, to: string, opt: { gist: boolean; open: boolean; title?: string }): string {
  const inRange = (iso: string | null) => !!iso && localDay(iso) >= from && localDay(iso) <= to;
  const commits = Object.values(p.commits).filter((c) => inRange(c.createdAt)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const newBranches = sortedBranches(p).filter((b) => b.baseId && inRange(b.createdAt));
  const closed = Object.values(p.tasks).filter((t) => inRange(t.closedAt)).sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''));
  const created = Object.values(p.tasks).filter((t) => inRange(t.createdAt));
  const open = Object.values(p.tasks).filter(isOpenTask).sort((a, b) => (a.status === 'doing' ? -1 : 0) - (b.status === 'doing' ? -1 : 0) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.number - b.number);
  const merges = commits.filter((c) => c.mergeParentId);
  const tagNames = (c: Commit) => c.tagIds.map((t) => p.tags[t]?.name).filter(Boolean).join('・');

  const out: string[] = [`# ${opt.title ?? '進捗報告'}`, '', `- プロジェクト: **${p.name}**`, `- 期間: ${slash(from)}〜${slash(to)}`, ''];

  // 概要
  const byBranch = new Map<string, Commit[]>();
  for (const c of commits) byBranch.set(c.branchId, [...(byBranch.get(c.branchId) ?? []), c]);
  out.push('## 概要', '');
  out.push(`- 新しい記録: ${commits.length} 件${byBranch.size ? `（${[...byBranch.entries()].map(([b, cs]) => `${p.branches[b]?.name ?? '?'} ${cs.length}`).join('、')}）` : ''}`);
  out.push(`- 完了したタスク: ${closed.filter((t) => t.status === 'done').length} 件 ／ 新しいタスク: ${created.length} 件 ／ 残りのタスク: ${open.length} 件`);
  if (newBranches.length) out.push(`- 新しく始めた筋: ${newBranches.map((b) => `「${b.name}」`).join('、')}`);
  out.push('');

  // やったこと
  out.push('## やったこと', '');
  if (!commits.length) out.push('（この期間の記録はありません）', '');
  for (const b of sortedBranches(p)) {
    const cs = byBranch.get(b.id);
    if (!cs) continue;
    out.push(`### ${b.name}（${STATUS_LABEL[b.status]}）`, '');
    for (const c of cs) {
      const tags = tagNames(c);
      out.push(`- ${md(c.createdAt)} ${c.title}${tags ? ` 〔${tags}〕` : ''}`);
      if (c.results.length) out.push(`  - 結果: ${c.results.map((r) => `${r.key}=${r.value}`).join(', ')}`);
      if (opt.gist) { const g = gist(c.body); if (g) out.push(`  - ${g}`); }
    }
    out.push('');
  }

  // 方針の変化
  const turns: string[] = [];
  for (const b of newBranches) {
    const base = b.baseId ? p.commits[b.baseId] : null;
    turns.push(`- 「${b.name}」を開始（${STATUS_LABEL[b.status]}）${base ? ` — 分岐元: ${base.title}` : ''}${b.note ? `\n  - 理由: ${b.note}` : ''}`);
  }
  for (const c of merges) {
    const from = c.mergeParentId ? p.commits[c.mergeParentId] : null;
    turns.push(`- 「${from ? p.branches[from.branchId]?.name : '?'}」を「${p.branches[c.branchId]?.name}」に統合（${md(c.createdAt)}）`);
  }
  for (const b of sortedBranches(p)) {
    if (b.status !== 'abandoned' || newBranches.includes(b)) continue;
    const last = ownCommits(p, b).slice(-1)[0];
    if (last && inRange(last.createdAt)) turns.push(`- 「${b.name}」は棄却${b.note ? ` — ${b.note}` : ''}`);
  }
  if (turns.length) out.push('## 方針の変化', '', ...turns, '');

  // タスク
  const done = closed.filter((t) => t.status === 'done');
  const dropped = closed.filter((t) => t.status === 'dropped');
  if (done.length || dropped.length) {
    out.push('## 完了したタスク', '');
    for (const t of done) out.push(`- [x] #${t.number} ${t.title}（${md(t.closedAt!)}）`);
    for (const t of dropped) out.push(`- [ ] ~~#${t.number} ${t.title}~~（見送り）`);
    out.push('');
  }
  if (opt.open && open.length) {
    out.push('## 次にやること', '');
    for (const t of open) {
      const ms = t.milestoneId ? p.milestones[t.milestoneId] : null;
      const extra = [TASK_STATUS_LABEL[t.status], t.due && `期限 ${slash(t.due)}`, ms && `🏁 ${ms.title}`].filter(Boolean).join('・');
      out.push(`- [ ] #${t.number} ${t.title}（${extra}）`);
    }
    out.push('');
  }

  // 予定
  const upcoming = sortedMilestones(p).filter((m) => m.date >= today());
  if (upcoming.length) {
    out.push('## 今後の予定', '');
    for (const m of upcoming) {
      const { done: d, total } = milestoneProgress(p, m);
      out.push(`- 🏁 ${slash(m.date)} ${m.title}（あと ${daysUntil(m.date)} 日${total ? `、タスク ${d}/${total} 完了` : ''}）`);
    }
    out.push('');
  }

  // 自分で書く欄
  out.push('## 所感・相談したいこと', '', '- （ここに記入）', '');
  return out.join('\n');
}

// ---------- 期間・タイトル ----------

const addDays = (s: string, n: number) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return ymd(x); };
const dayDiff = (a: string, b: string) => {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000);
};
const mondayOf = (s: string) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); const dow = (dt.getDay() + 6) % 7; return addDays(s, -dow); };

/** 期間から「週報」「11月の月報」などのタイトルを作る */
export function autoTitle(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const lastDay = new Date(ty, tm, 0).getDate();
  // 月初から月末（または今日）まで → 月報
  if (fd === 1 && from.slice(0, 7) === to.slice(0, 7) && (td === lastDay || to === today())) return `${fy}年${fm}月の月報`;
  const len = dayDiff(from, to) + 1;
  const kind = len <= 7 ? '週報' : len >= 28 ? '月報' : '進捗報告';
  return `${kind}（${fm}/${fd}〜${tm}/${td}）`;
}

interface Preset { label: string; range: () => [string, string] }

function presets(p: Project): Preset[] {
  const t = today();
  const last = Object.values(p.reports).sort((a, b) => b.to.localeCompare(a.to))[0];
  const list: Preset[] = [
    { label: '今週', range: () => [mondayOf(t), t] },
    { label: '先週', range: () => { const m = addDays(mondayOf(t), -7); return [m, addDays(m, 6)]; } },
    { label: '今月', range: () => [t.slice(0, 8) + '01', t] },
    { label: '先月', range: () => { const [y, m] = t.split('-').map(Number); const first = ymd(new Date(y, m - 2, 1)); return [first, ymd(new Date(y, m - 1, 0))]; } },
    { label: '直近7日', range: () => [daysAgo(6), t] },
  ];
  if (last && last.to < t) list.unshift({ label: '前回の報告以降', range: () => [addDays(last.to, 1), t] });
  return list;
}

// ---------- 画面 ----------

type Draft = { id: ID | null; title: string; from: string; to: string; body: string };

export function ReportView({ project: p, onSave, onDelete }: {
  project: Project;
  onSave: (r: { title: string; from: string; to: string; body: string }, id: ID | null) => ID | null;
  onDelete: (id: ID) => void;
}) {
  const saved = Object.values(p.reports).sort((a, b) => b.to.localeCompare(a.to) || b.createdAt.localeCompare(a.createdAt));
  const [selId, setSelId] = useState<ID | null>(saved[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [withGist, setWithGist] = useState(false);
  const [withOpen, setWithOpen] = useState(true);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const sel = selId ? p.reports[selId] : null;

  // 見出しはタイトルに合わせる（タイトルを手で変えていればそれを使う）
  const headingFor = (from: string, to: string) => (draft && draft.title !== autoTitle(draft.from, draft.to) ? draft.title : autoTitle(from, to));
  const generate = (from: string, to: string, gist = withGist, open = withOpen) => buildReport(p, from, to, { gist, open, title: headingFor(from, to) });

  const startNew = () => {
    const pr = presets(p);
    const [from, to] = pr[0].label === '前回の報告以降' ? pr[0].range() : [daysAgo(6), today()];
    setDraft({ id: null, title: autoTitle(from, to), from, to, body: generate(from, to) });
    setDirty(false);
    setPreview(false);
  };
  // 期間・設定を変えたら、手で編集していない間は自動で作り直す
  const setRange = (from: string, to: string) => {
    if (!draft) return;
    const titleAuto = draft.title === autoTitle(draft.from, draft.to);
    setDraft({ ...draft, from, to, title: titleAuto ? autoTitle(from, to) : draft.title, body: dirty ? draft.body : generate(from, to) });
  };
  const setOpt = (gist: boolean, open: boolean) => {
    setWithGist(gist); setWithOpen(open);
    if (draft && !dirty) setDraft({ ...draft, body: generate(draft.from, draft.to, gist, open) });
  };
  const regenerate = () => { if (draft) { setDraft({ ...draft, body: generate(draft.from, draft.to) }); setDirty(false); } };
  const save = () => {
    if (!draft || !draft.title.trim()) return;
    const id = onSave({ title: draft.title.trim(), from: draft.from, to: draft.to, body: draft.body }, draft.id);
    if (id) { setSelId(id); setDraft(null); setDirty(false); }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  const download = (title: string, text: string) => {
    const blob = new Blob([text], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="report-layout">
      <aside className="report-list">
        <button className="btn primary" onClick={startNew}>＋ 新しい報告を作る</button>
        <p className="hint">期間を選ぶと、その間の記録・タスク・ブランチから下書きを自動で作ります。</p>
        {saved.length === 0 && <p className="muted small">保存した報告はまだありません。</p>}
        <ul>
          {saved.map((r) => (
            <li key={r.id}>
              <button className={`report-item${!draft && selId === r.id ? ' sel' : ''}${draft?.id === r.id ? ' sel' : ''}`} onClick={() => { setSelId(r.id); setDraft(null); }}>
                <b>{r.title}</b>
                <span className="muted small">{slash(r.from)}〜{slash(r.to)}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="report-main">
        {draft ? (
          <div className="report-editor">
            <div className="outline-toolbar">
              <label className="field-inline">期間
                <input type="date" value={draft.from} max={draft.to} onChange={(e) => e.target.value && setRange(e.target.value, draft.to)} />〜
                <input type="date" value={draft.to} min={draft.from} onChange={(e) => e.target.value && setRange(draft.from, e.target.value)} />
              </label>
              <div className="seg">
                {presets(p).map((pr) => <button key={pr.label} onClick={() => { const [f, t] = pr.range(); setRange(f, t); }}>{pr.label}</button>)}
              </div>
            </div>
            <div className="outline-toolbar">
              <label className="check"><input type="checkbox" checked={withGist} onChange={(e) => setOpt(e.target.checked, withOpen)} />本文の要点も入れる（オフ: タイトルだけ）</label>
              <label className="check"><input type="checkbox" checked={withOpen} onChange={(e) => setOpt(withGist, e.target.checked)} />次にやること（未完了タスク）</label>
              {dirty && <button className="btn sm" onClick={regenerate} title="手で編集した内容は消えます">記録から作り直す</button>}
            </div>
            <label className="field">
              <span>タイトル</span>
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <div className="field">
              <span className="field-row">
                本文（Markdown・自由に書き足せます）
                <span className="seg">
                  <button className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>編集</button>
                  <button className={preview ? 'on' : ''} onClick={() => setPreview(true)}>プレビュー</button>
                </span>
              </span>
              {preview
                ? <div className="report-box"><Markdown text={draft.body} /></div>
                : <textarea className="report-text" value={draft.body} onChange={(e) => { setDraft({ ...draft, body: e.target.value }); setDirty(true); }} />}
            </div>
            <div className="editor-actions">
              {!dirty && <span className="muted small">期間や設定を変えると下書きも自動で更新されます</span>}
              <span className="spacer" />
              <button className="btn ghost" onClick={() => setDraft(null)}>キャンセル</button>
              <button className="btn primary" onClick={save} disabled={!draft.title.trim()}>保存</button>
            </div>
          </div>
        ) : sel ? (
          <div>
            <div className="outline-toolbar">
              <div>
                <h2 className="report-title">{sel.title}</h2>
                <span className="muted small">{slash(sel.from)}〜{slash(sel.to)} ・ 更新 {slash(localDay(sel.updatedAt))}</span>
              </div>
              <span className="spacer" />
              <button className="btn" onClick={() => { setDraft({ id: sel.id, title: sel.title, from: sel.from, to: sel.to, body: sel.body }); setDirty(true); setPreview(false); }}>編集</button>
              <button className="btn" onClick={() => copy(sel.body)}>{copied ? 'コピーしました' : 'Markdown をコピー'}</button>
              <button className="btn" onClick={() => download(sel.title, sel.body)}>.md で保存</button>
              <button className="btn danger-ghost" onClick={() => onDelete(sel.id)}>削除</button>
            </div>
            <div className="report-box"><Markdown text={sel.body} /></div>
          </div>
        ) : (
          <div className="empty">
            <p>週報・月報などの進捗報告を作って保存できます。</p>
            <p className="muted">「＋ 新しい報告を作る」を押すと、期間内の記録のタイトル・完了したタスク・次にやることなどが自動で並んだ下書きができます。<br />足りないところを書き足して保存してください。</p>
          </div>
        )}
      </section>
    </div>
  );
}
