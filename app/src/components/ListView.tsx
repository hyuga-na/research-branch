import { useState } from 'react';
import type { Commit, ID, Project } from '../types';
import { matchesFilter } from '../store';
import { branchColorMap } from '../graph';
import { fmtDate, TagChip } from './ui';

export function ListView({
  project: p, tagFilter, tagMode, query, selectedId, onSelect,
}: {
  project: Project;
  tagFilter: ID[];
  tagMode: 'any' | 'all';
  query: string;
  selectedId: ID | null;
  onSelect: (id: ID) => void;
}) {
  const [group, setGroup] = useState(true);
  const colors = branchColorMap(p);
  const items = Object.values(p.commits)
    .filter((c) => matchesFilter(c, tagFilter, query, tagMode))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const groups: { key: string; label: React.ReactNode; items: Commit[] }[] = [];
  if (group) {
    for (const tid of p.tagOrder) {
      const tag = p.tags[tid];
      if (!tag) continue;
      const its = items.filter((c) => c.tagIds.includes(tid));
      if (its.length) groups.push({ key: tid, label: <TagChip tag={tag} />, items: its });
    }
    const none = items.filter((c) => c.tagIds.length === 0);
    if (none.length) groups.push({ key: '_none', label: <span className="muted">タグなし</span>, items: none });
  } else {
    groups.push({ key: 'all', label: null, items });
  }

  return (
    <div className="listview">
      <div className="list-toolbar">
        <span className="muted">{items.length} 件</span>
        <label className="check">
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />
          タグごとにまとめる
        </label>
      </div>
      {items.length === 0 && <div className="empty"><p>条件に合う記録はありません。</p></div>}
      {groups.map((g) => (
        <section key={g.key} className="list-group">
          {g.label && <h3 className="list-group-head">{g.label}<span className="muted small">{g.items.length}</span></h3>}
          <ul className="list">
            {g.items.map((c) => (
              <li key={c.id}>
                <button className={`list-item${selectedId === c.id ? ' sel' : ''}`} onClick={() => onSelect(c.id)}>
                  <span className="list-date">{fmtDate(c.createdAt)}</span>
                  <span className="list-title">{c.title}</span>
                  <span className="list-branch"><span className="dot" style={{ background: colors.get(c.branchId) }} />{p.branches[c.branchId]?.name}</span>
                  <span className="list-tags">{c.tagIds.map((t) => p.tags[t] && <TagChip key={t} tag={p.tags[t]} small />)}</span>
                  {c.body && <span className="list-snippet">{c.body.replace(/[#*`>\-]/g, '').slice(0, 140)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
