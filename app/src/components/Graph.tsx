import { useMemo, useRef, useState } from 'react';
import type { ID, Project } from '../types';
import { branchesAtHead, matchesFilter } from '../store';
import { layoutGraph } from '../graph';
import { countAttachments } from '../wiki';
import { fmtDate, TagChip } from './ui';

const ROW_H = 48;
const COL_W = 22;
const PAD = 16;

interface Props {
  project: Project;
  selectedId: ID | null;
  onSelect: (id: ID) => void;
  onCheckout: (branchId: ID) => void;
  tagFilter: ID[];
  tagMode: 'any' | 'all';
  query: string;
  hideAbandoned: boolean;
  /** 記録 id を afterId の直後へ移動（null なら先頭へ） */
  onMove: (id: ID, afterId: ID | null) => void;
}

const TOP = '__top';

export function Graph({ project: p, selectedId, onSelect, onCheckout, tagFilter, tagMode, query, hideAbandoned, onMove }: Props) {
  const [dragId, setDragIdState] = useState<ID | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // 画面の更新を待たずに参照できるよう、ドラッグ中の記録は ref にも持つ
  const dragRef = useRef<ID | null>(null);
  const setDragId = (id: ID | null) => { dragRef.current = id; setDragIdState(id); };
  const endDrag = () => { setDragId(null); setOverId(null); };
  const drop = (target: string) => {
    const id = dragRef.current;
    endDrag();
    if (!id || id === target) return;
    onMove(id, target === TOP ? null : target);
  };
  const layout = useMemo(
    () => layoutGraph(p, { hideAbandoned, focusBranchId: p.currentBranchId }),
    [p, hideAbandoned],
  );
  const filtering = tagFilter.length > 0 || query.trim() !== '';
  const openTasksFrom = useMemo(() => {
    const m = new Map<ID, number>();
    for (const t of Object.values(p.tasks)) {
      if (t.sourceCommitId && (t.status === 'todo' || t.status === 'doing')) m.set(t.sourceCommitId, (m.get(t.sourceCommitId) ?? 0) + 1);
    }
    return m;
  }, [p.tasks]);
  const x = (col: number) => PAD + col * COL_W;
  const y = (row: number) => row * ROW_H + ROW_H / 2;
  const gw = PAD * 2 + (layout.cols - 1) * COL_W;
  const height = layout.rows.length * ROW_H;
  const current = p.branches[p.currentBranchId];

  if (layout.rows.length === 0) {
    return (
      <div className="empty">
        <p>まだ記録がありません。</p>
        <p className="muted">右上の「＋ 記録する」から、最初のステップ（研究の出発点となる問いや動機など）を記録しましょう。</p>
      </div>
    );
  }

  return (
    <div className={`graph${dragId ? ' dragging' : ''}`} style={{ height }}>
      {dragId && (
        <div
          className={`drop-top${overId === TOP ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverId(TOP); }}
          onDragLeave={() => setOverId((o) => (o === TOP ? null : o))}
          onDrop={(e) => { e.preventDefault(); drop(TOP); }}
        >
          ↑ ここに落とすと、いちばん最初の記録にします
        </div>
      )}
      <svg className="graph-svg" width={gw} height={height} aria-hidden>
        {layout.edges.map((e) => {
          const x1 = x(e.from.col), y1 = y(e.from.row), x2 = x(e.to.col), y2 = y(e.to.row);
          const d = x1 === x2
            ? `M${x1} ${y1} L${x2} ${y2}`
            : e.merge
              // 統合: 統合元のレーンを下りてから、統合先へ合流する
              ? `M${x1} ${y1} L${x1} ${y2 - ROW_H} C${x1} ${y2 - ROW_H * 0.4} ${x2} ${y2 - ROW_H * 0.6} ${x2} ${y2}`
              : `M${x1} ${y1} C${x1} ${y1 + ROW_H * 0.6} ${x2} ${y1 + ROW_H * 0.4} ${x2} ${y1 + ROW_H} L${x2} ${y2}`;
          return (
            <path
              key={e.to.commit.id + (e.merge ? '-m' : '')}
              d={d}
              fill="none"
              stroke={e.color}
              strokeWidth={e.onPath ? 3 : 2}
              strokeDasharray={e.dashed ? '4 4' : undefined}
              opacity={e.onPath ? 1 : 0.5}
            />
          );
        })}
        {layout.rows.map((r) => {
          const match = !filtering || matchesFilter(r.commit, tagFilter, query, tagMode);
          const isHead = current.headId === r.commit.id;
          return (
            <g key={r.commit.id} opacity={match ? 1 : 0.35}>
              {isHead && <circle cx={x(r.col)} cy={y(r.row)} r={10} fill="none" stroke={r.color} strokeWidth={2} />}
              <circle
                cx={x(r.col)}
                cy={y(r.row)}
                r={6}
                fill={match && filtering ? r.color : 'var(--bg)'}
                stroke={r.color}
                strokeWidth={2.5}
              />
            </g>
          );
        })}
      </svg>
      {layout.rows.map((r) => {
        const c = r.commit;
        const match = !filtering || matchesFilter(c, tagFilter, query, tagMode);
        const heads = branchesAtHead(p, c.id);
        return (
          <div
            key={c.id}
            className={`grow${selectedId === c.id ? ' grow-selected' : ''}${match ? '' : ' grow-dim'}${dragId === c.id ? ' grow-dragging' : ''}${overId === c.id && dragId !== c.id ? ' grow-drop' : ''}`}
            style={{ height: ROW_H, paddingLeft: gw + 4 }}
            onClick={() => onSelect(c.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(c.id); }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', c.title);
              setDragId(c.id);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              if (!dragRef.current || dragRef.current === c.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overId !== c.id) setOverId(c.id);
            }}
            onDrop={(e) => { e.preventDefault(); drop(c.id); }}
            title="ドラッグして別の記録の上に落とすと、その記録の直後に移動します"
          >
            <span className="drag-handle" aria-hidden>⋮⋮</span>
            {overId === c.id && dragId && dragId !== c.id && (
              <span className="drop-label">↓ 「{p.commits[dragId]?.title.slice(0, 18)}」をこの記録の後ろへ</span>
            )}
            <div className="grow-main">
              <span className="grow-title">{c.title || '(無題)'}</span>
              {heads.map((b) => (
                <button
                  key={b.id}
                  className={`blabel${b.id === p.currentBranchId ? ' blabel-current' : ''}${b.status === 'abandoned' ? ' blabel-abandoned' : ''}`}
                  style={{ '--bc': layout.branchColor.get(b.id) } as React.CSSProperties}
                  title={b.id === p.currentBranchId ? '現在のブランチ（HEAD）' : 'クリックでこのブランチに切り替え'}
                  onClick={(e) => { e.stopPropagation(); onCheckout(b.id); }}
                >
                  {b.id === p.currentBranchId && <span className="head-mark">HEAD →</span>}
                  {b.name}
                </button>
              ))}
              {c.mergeParentId && <span className="att" title="ブランチを統合した記録">⇄ 統合</span>}
              {openTasksFrom.get(c.id) && (
                <span className="task-mark" title="この記録から作った未完了のタスク">☐ {openTasksFrom.get(c.id)}</span>
              )}
              {countAttachments(c.body) > 0 && (
                <span className="att" title="画像・ファイルの添付あり">📎{countAttachments(c.body)}</span>
              )}
              <span className="grow-tags">
                {c.tagIds.map((t) => p.tags[t] && <TagChip key={t} tag={p.tags[t]} small />)}
              </span>
            </div>
            <span className="grow-date">{fmtDate(c.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
