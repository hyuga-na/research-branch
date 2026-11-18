import { useState } from 'react';
import type { Branch, ID, Project } from '../types';
import { ownCommits, sortedBranches, TAG_COLORS } from '../store';
import { branchColorMap } from '../graph';
import { StatusBadge, TagChip } from './ui';

interface Props {
  project: Project;
  onCheckout: (id: ID) => void;
  onEditBranch: (b: Branch) => void;
  tagFilter: ID[];
  setTagFilter: (f: ID[]) => void;
  tagMode: 'any' | 'all';
  setTagMode: (m: 'any' | 'all') => void;
  hideAbandoned: boolean;
  setHideAbandoned: (v: boolean) => void;
  onAddTag: (name: string, color: string) => void;
  onEditTags: () => void;
  onMerge: () => void;
}

export function Sidebar(props: Props) {
  const { project: p, tagFilter, setTagFilter } = props;
  const colors = branchColorMap(p);
  const [newTag, setNewTag] = useState('');
  const counts = new Map<ID, number>();
  for (const c of Object.values(p.commits)) for (const t of c.tagIds) counts.set(t, (counts.get(t) ?? 0) + 1);

  const toggle = (id: ID) =>
    setTagFilter(tagFilter.includes(id) ? tagFilter.filter((t) => t !== id) : [...tagFilter, id]);

  return (
    <aside className="sidebar">
      <section>
        <div className="side-head">
          <h3>ブランチ</h3>
          <label className="check" title="棄却したブランチをグラフから隠す">
            <input type="checkbox" checked={props.hideAbandoned} onChange={(e) => props.setHideAbandoned(e.target.checked)} />
            棄却を隠す
          </label>
        </div>
        <ul className="branch-list">
          {sortedBranches(p).map((b) => {
            const isCur = b.id === p.currentBranchId;
            const base = b.baseId ? p.commits[b.baseId] : null;
            return (
              <li key={b.id} className={isCur ? 'cur' : ''}>
                <button className="branch-item" onClick={() => props.onCheckout(b.id)} title={base ? `分岐元: ${base.title}` : '幹（最初の筋）'}>
                  <span className="dot" style={{ background: colors.get(b.id) }} />
                  <span className="bname">{b.name}</span>
                  <span className="bcount">{ownCommits(p, b).length}</span>
                  <StatusBadge status={b.status} />
                </button>
                <button className="icon-btn sm" onClick={() => props.onEditBranch(b)} aria-label={`${b.name} を編集`} title="編集">✎</button>
              </li>
            );
          })}
        </ul>
        {Object.keys(p.branches).length > 1 && (
          <button className="btn sm merge-side-btn" onClick={props.onMerge} title="別のブランチの成果を、現在のブランチ（HEAD）に取り込む">
            ⇄ 現在のブランチに統合…
          </button>
        )}
        <p className="hint">記録を選んで「ここから分岐」で新しい筋を作れます。寄り道した筋の成果は「統合」で本線に取り込めます。</p>
      </section>

      <section>
        <div className="side-head">
          <h3>タグで絞り込み</h3>
          <div className="seg">
            <button className={props.tagMode === 'any' ? 'on' : ''} onClick={() => props.setTagMode('any')} title="いずれかのタグを含む">OR</button>
            <button className={props.tagMode === 'all' ? 'on' : ''} onClick={() => props.setTagMode('all')} title="すべてのタグを含む">AND</button>
          </div>
        </div>
        <div className="tag-list">
          {p.tagOrder.map((id) => p.tags[id] && (
            <span key={id} className="tag-row">
              <TagChip tag={p.tags[id]} active={tagFilter.includes(id)} onClick={() => toggle(id)} />
              <span className="tcount">{counts.get(id) ?? 0}</span>
            </span>
          ))}
        </div>
        <div className="row-gap">
          {tagFilter.length > 0 && <button className="link-btn" onClick={() => setTagFilter([])}>絞り込みを解除</button>}
          <button className="link-btn" onClick={props.onEditTags}>タグを管理</button>
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newTag.trim();
            if (!name) return;
            props.onAddTag(name, TAG_COLORS[p.tagOrder.length % TAG_COLORS.length]);
            setNewTag('');
          }}
        >
          <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="新しいタグ" aria-label="新しいタグ名" />
          <button type="submit" className="btn sm">追加</button>
        </form>
      </section>
    </aside>
  );
}
