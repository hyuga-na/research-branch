import type { Branch, Commit, ID, Project } from './types';
import { fullLineage, sortedBranches } from './store';

export const BRANCH_COLORS = [
  '#4f7cff', '#e8833a', '#2fa36b', '#c94f7c', '#8a63d2', '#2a9bb5', '#c9a227', '#d0573f', '#5b9e3a', '#9a5bb5',
];

export interface GraphRow {
  commit: Commit;
  row: number;
  col: number;
  color: string;
}

export interface GraphEdge {
  from: GraphRow;
  to: GraphRow;
  color: string;
  dashed: boolean;
  onPath: boolean;
  /** ブランチの統合（merge）を表す線 */
  merge?: boolean;
}

export interface GraphLayout {
  rows: GraphRow[];
  edges: GraphEdge[];
  cols: number;
  branchColor: Map<ID, string>;
}

export function branchColorMap(p: Project): Map<ID, string> {
  const m = new Map<ID, string>();
  sortedBranches(p).forEach((b, i) => m.set(b.id, BRANCH_COLORS[i % BRANCH_COLORS.length]));
  return m;
}

/**
 * git log --graph 風のレイアウト。上が古く、下が新しい（論文の流れと同じ向き）。
 * 各ブランチに1レーンを割り当て、期間が重ならないレーンは再利用する。
 */
export function layoutGraph(p: Project, opts: { hideAbandoned: boolean; focusBranchId: ID }): GraphLayout {
  const branchColor = branchColorMap(p);
  const hidden = (b: Branch | undefined) => !b || (opts.hideAbandoned && b.status === 'abandoned' && b.id !== opts.focusBranchId);

  const sorted = Object.values(p.commits).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const visible: Commit[] = [];
  const visibleIds = new Set<ID>();
  for (const c of sorted) {
    if (hidden(p.branches[c.branchId])) continue;
    if (c.parentId && !visibleIds.has(c.parentId)) continue;
    visible.push(c);
    visibleIds.add(c.id);
  }
  const rowOf = new Map<ID, number>();
  visible.forEach((c, i) => rowOf.set(c.id, i));

  // ブランチごとの占有区間
  const spans = new Map<ID, [number, number]>();
  for (const c of visible) {
    const r = rowOf.get(c.id)!;
    const s = spans.get(c.branchId);
    if (!s) {
      const b = p.branches[c.branchId];
      const start = b?.baseId && rowOf.has(b.baseId) ? rowOf.get(b.baseId)! : r;
      spans.set(c.branchId, [start, r]);
    } else s[1] = r;
  }
  // 統合されたブランチのレーンは、統合する行まで使用中にする
  for (const c of visible) {
    if (!c.mergeParentId || !rowOf.has(c.mergeParentId)) continue;
    const s = spans.get(p.commits[c.mergeParentId].branchId);
    if (s) s[1] = Math.max(s[1], rowOf.get(c.id)!);
  }
  const lanes: [number, number][][] = [];
  const colOf = new Map<ID, number>();
  for (const b of sortedBranches(p)) {
    const span = spans.get(b.id);
    if (!span) continue;
    let col = 0;
    if (b.baseId !== null) {
      col = 1;
      while ((lanes[col] ?? []).some(([s, e]) => span[0] <= e && s <= span[1])) col++;
    }
    (lanes[col] ??= []).push(span);
    colOf.set(b.id, col);
  }

  const rows: GraphRow[] = visible.map((c, i) => ({
    commit: c,
    row: i,
    col: colOf.get(c.branchId) ?? 0,
    color: branchColor.get(c.branchId) ?? BRANCH_COLORS[0],
  }));
  const byId = new Map(rows.map((r) => [r.commit.id, r]));
  const focusPath = new Set(fullLineage(p, p.branches[opts.focusBranchId]?.headId ?? null).map((c) => c.id));

  const edges: GraphEdge[] = [];
  for (const r of rows) {
    const parent = r.commit.parentId ? byId.get(r.commit.parentId) : undefined;
    if (!parent) continue;
    edges.push({
      from: parent,
      to: r,
      color: r.color,
      dashed: p.branches[r.commit.branchId]?.status === 'abandoned',
      onPath: focusPath.has(r.commit.id),
    });
    const mp = r.commit.mergeParentId ? byId.get(r.commit.mergeParentId) : undefined;
    if (mp) {
      edges.push({
        from: mp,
        to: r,
        color: mp.color,
        dashed: false,
        onPath: focusPath.has(r.commit.id),
        merge: true,
      });
    }
  }
  return { rows, edges, cols: Math.max(1, lanes.length), branchColor };
}
