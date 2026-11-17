import { useMemo, useState } from 'react';
import type { Branch, Commit, ID, Project } from '../types';
import { lineage, ownCommits, sortedBranches } from '../store';
import { branchColorMap } from '../graph';
import { Markdown, STATUS_LABEL, StatusBadge, TagChip } from './ui';

type Mode = 'flow' | 'tag';

interface Step {
  commit: Commit;
  forks: { branch: Branch; commits: Commit[] }[];
}

function buildSteps(p: Project, branchId: ID): Step[] {
  const path = lineage(p, p.branches[branchId]?.headId ?? null);
  const onPath = new Set(path.map((c) => c.id));
  return path.map((c) => ({
    commit: c,
    // この地点から分かれた、採用ルート以外の筋（出戻りの記録）
    forks: sortedBranches(p)
      .filter((b) => b.baseId === c.id && !(b.headId && onPath.has(b.headId)) && b.id !== branchId)
      .map((b) => ({ branch: b, commits: ownCommits(p, b) }))
      .filter((f) => f.commits.length > 0 || f.branch.note),
  }));
}

function primaryTag(p: Project, c: Commit): ID | null {
  return p.tagOrder.find((t) => c.tagIds.includes(t)) ?? null;
}

const demote = (md: string) => md.replace(/^(#{1,4})(\s)/gm, '$1##$2');

function toMarkdown(p: Project, branchId: ID, steps: Step[], mode: Mode, withBody: boolean, withForks: boolean): string {
  const b = p.branches[branchId];
  const out: string[] = [`# ${p.name}`, '', `> 論文構成案 — ブランチ「${b.name}」の筋（${steps.length} ステップ）`, ''];
  const tagNames = (c: Commit) => c.tagIds.map((t) => p.tags[t]?.name).filter(Boolean).join(', ');
  const renderStep = (s: Step, n: string, level: string) => {
    out.push(`${level} ${n} ${s.commit.title}`, '');
    if (s.commit.tagIds.length) out.push(`*${tagNames(s.commit)}*`, '');
    if (withBody && s.commit.body.trim()) out.push(demote(s.commit.body.trim()), '');
    if (withBody && s.commit.links.length) out.push(...s.commit.links.map((l) => `- ${l}`), '');
    if (withForks) {
      for (const f of s.forks) {
        out.push(`> **検討した別の筋: ${f.branch.name}（${STATUS_LABEL[f.branch.status]}）**${f.branch.note ? ` — ${f.branch.note}` : ''}`);
        for (const c of f.commits) out.push(`> - ${c.title}`);
        out.push('');
      }
    }
  };
  if (mode === 'flow') {
    steps.forEach((s, i) => renderStep(s, `${i + 1}.`, '##'));
  } else {
    const sections = [...p.tagOrder.filter((t) => p.tags[t]), null];
    let sec = 0;
    for (const t of sections) {
      const its = steps.filter((s) => primaryTag(p, s.commit) === t);
      if (!its.length) continue;
      sec++;
      out.push(`## ${sec}. ${t ? p.tags[t].name : 'その他'}`, '');
      its.forEach((s, i) => renderStep(s, `${sec}.${i + 1}`, '###'));
    }
  }
  return out.join('\n');
}

export function Outline({ project: p, onSelect }: { project: Project; onSelect: (id: ID) => void }) {
  const [branchId, setBranchId] = useState<ID>(p.currentBranchId);
  const [mode, setMode] = useState<Mode>('flow');
  const [withBody, setWithBody] = useState(false);
  const [withForks, setWithForks] = useState(true);
  const [copied, setCopied] = useState(false);
  const bid = p.branches[branchId] ? branchId : p.currentBranchId;
  const colors = branchColorMap(p);
  const steps = useMemo(() => buildSteps(p, bid), [p, bid]);
  const md = useMemo(() => toMarkdown(p, bid, steps, mode, withBody, withForks), [p, bid, steps, mode, withBody, withForks]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  const download = () => {
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.name}-${p.branches[bid].name}-outline.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const renderStep = (s: Step, label: string) => (
    <li key={s.commit.id} className="ostep">
      <div className="ostep-num">{label}</div>
      <div className="ostep-card">
        <button className="ostep-title link-btn" onClick={() => onSelect(s.commit.id)}>{s.commit.title}</button>
        <div className="tag-pick">{s.commit.tagIds.map((t) => p.tags[t] && <TagChip key={t} tag={p.tags[t]} small />)}</div>
        {withBody && s.commit.body.trim() && <Markdown text={s.commit.body} />}
        {withForks && s.forks.map((f) => (
          <div key={f.branch.id} className="ofork" style={{ '--bc': colors.get(f.branch.id) } as React.CSSProperties}>
            <div className="ofork-head">⑂ 検討した別の筋: <b>{f.branch.name}</b> <StatusBadge status={f.branch.status} /></div>
            {f.branch.note && <div className="muted small">理由: {f.branch.note}</div>}
            <ul>{f.commits.map((c) => <li key={c.id}><button className="link-btn" onClick={() => onSelect(c.id)}>{c.title}</button></li>)}</ul>
          </div>
        ))}
      </div>
    </li>
  );

  let body: React.ReactNode;
  if (mode === 'flow') {
    body = <ol className="ol-steps">{steps.map((s, i) => renderStep(s, String(i + 1)))}</ol>;
  } else {
    const sections = [...p.tagOrder.filter((t) => p.tags[t]), null];
    let sec = 0;
    body = sections.map((t) => {
      const its = steps.filter((s) => primaryTag(p, s.commit) === t);
      if (!its.length) return null;
      sec++;
      const n = sec;
      return (
        <section key={t ?? '_'} className="osection">
          <h3>{n}. {t ? p.tags[t].name : 'その他'}</h3>
          <ol className="ol-steps">{its.map((s, i) => renderStep(s, `${n}.${i + 1}`))}</ol>
        </section>
      );
    });
  }

  return (
    <div className="outline">
      <div className="outline-toolbar">
        <label className="field-inline">
          採用する筋
          <select value={bid} onChange={(e) => setBranchId(e.target.value)}>
            {sortedBranches(p).map((b) => <option key={b.id} value={b.id}>{b.name}（{STATUS_LABEL[b.status]}）</option>)}
          </select>
        </label>
        <div className="seg">
          <button className={mode === 'flow' ? 'on' : ''} onClick={() => setMode('flow')}>ロジック順</button>
          <button className={mode === 'tag' ? 'on' : ''} onClick={() => setMode('tag')}>タグ別に章立て</button>
        </div>
        <label className="check"><input type="checkbox" checked={withBody} onChange={(e) => setWithBody(e.target.checked)} />本文を含める</label>
        <label className="check"><input type="checkbox" checked={withForks} onChange={(e) => setWithForks(e.target.checked)} />分岐した筋を表示</label>
        <span className="spacer" />
        <button className="btn" onClick={copy}>{copied ? 'コピーしました' : 'Markdown をコピー'}</button>
        <button className="btn" onClick={download}>.md で保存</button>
      </div>
      <p className="hint">
        選んだブランチの先端から最初の記録まで辿った一本の筋です。上から順に読むと論文の構成になります。
        「分岐した筋」は出戻りで試した別案で、考察や関連研究の材料になります。
      </p>
      {steps.length === 0 ? <div className="empty"><p>このブランチにはまだ記録がありません。</p></div> : body}
    </div>
  );
}
