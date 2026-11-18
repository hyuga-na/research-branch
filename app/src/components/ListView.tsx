import { useState } from 'react';
import type { Commit, ID, Project } from '../types';
import { matchesFilter } from '../store';
import { branchColorMap } from '../graph';
import { fmtDate, StatusBadge, TagChip } from './ui';

type Mode = 'list' | 'table';

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
  const [mode, setMode] = useState<Mode>('list');
  const [group, setGroup] = useState(true);
  const items = Object.values(p.commits)
    .filter((c) => matchesFilter(c, tagFilter, query, tagMode))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="listview">
      <div className="list-toolbar">
        <div className="seg">
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>リスト</button>
          <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')} title="記録に入力した「条件・結果の値」を並べて比べる">比較表</button>
        </div>
        {mode === 'list' && (
          <>
            <span className="muted">{items.length} 件</span>
            <label className="check">
              <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />
              タグごとにまとめる
            </label>
          </>
        )}
      </div>
      {mode === 'list'
        ? <RecordList p={p} items={items} group={group} selectedId={selectedId} onSelect={onSelect} />
        : <CompareTable p={p} items={items} selectedId={selectedId} onSelect={onSelect} />}
    </div>
  );
}

function RecordList({ p, items, group, selectedId, onSelect }: { p: Project; items: Commit[]; group: boolean; selectedId: ID | null; onSelect: (id: ID) => void }) {
  const colors = branchColorMap(p);
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
    <>
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
    </>
  );
}

/** 数値として比べられれば数値で、そうでなければ文字列で比較 */
function cmpValue(a: string | undefined, b: string | undefined): number {
  if (a === undefined || a === '') return b === undefined || b === '' ? 0 : 1;
  if (b === undefined || b === '') return -1;
  const na = parseFloat(a.replace(/[,%＋+]/g, '')), nb = parseFloat(b.replace(/[,%＋+]/g, ''));
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b, 'ja');
}

function CompareTable({ p, items, selectedId, onSelect }: { p: Project; items: Commit[]; selectedId: ID | null; onSelect: (id: ID) => void }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const colors = branchColorMap(p);
  const rows = items.filter((c) => c.results.length > 0);
  // 列 = 項目名（出現回数の多い順）
  const count = new Map<string, number>();
  for (const c of rows) for (const r of c.results) count.set(r.key, (count.get(r.key) ?? 0) + 1);
  const keys = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const val = (c: Commit, k: string) => c.results.find((r) => r.key === k)?.value;
  const sorted = sort
    ? [...rows].sort((a, b) => sort.dir * (sort.key === '__date' ? a.createdAt.localeCompare(b.createdAt) : cmpValue(val(a, sort.key), val(b, sort.key))))
    : rows;
  const head = (k: string, label: string) => (
    <th key={k}>
      <button className="th-btn" onClick={() => setSort(sort?.key === k ? { key: k, dir: sort.dir === 1 ? -1 : 1 } : { key: k, dir: -1 })}>
        {label}{sort?.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  if (rows.length === 0) {
    return (
      <div className="empty">
        <p>比べられる値がまだありません。</p>
        <p className="muted">記録の編集画面にある「📊 条件・結果の値」に、手法・seed・指標の値などを入れると、ここで表になります。<br />タグや検索で絞り込んだ記録だけが表に並びます。</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="compare-table">
        <thead>
          <tr>
            {head('__date', '日付')}
            <th>記録</th>
            <th>ブランチ</th>
            {keys.map((k) => head(k, k))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const b = p.branches[c.branchId];
            return (
              <tr key={c.id} className={`${selectedId === c.id ? 'sel' : ''}${b?.status === 'abandoned' ? ' row-muted' : ''}`} onClick={() => onSelect(c.id)}>
                <td className="nowrap muted">{fmtDate(c.createdAt)}</td>
                <td className="cell-title">{c.title}</td>
                <td className="nowrap"><span className="dot" style={{ background: colors.get(c.branchId) }} /> {b?.name} {b && b.status !== 'active' && <StatusBadge status={b.status} />}</td>
                {keys.map((k) => <td key={k} className="num">{val(c, k) ?? ''}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">列名をクリックすると並べ替えます。棄却したブランチの行は薄く表示されます。</p>
    </div>
  );
}
