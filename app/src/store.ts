import { useCallback, useEffect, useRef, useState } from 'react';
import type { Branch, BranchStatus, Commit, DB, ID, Milestone, Project, Reference, ResultItem, SavedReport, Tag, Task, TaskStatus } from './types';
import { renameWikiLinks } from './wiki';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();

export const TAG_COLORS = [
  '#4f7cff', '#e8833a', '#2fa36b', '#c94f7c', '#8a63d2', '#c9a227', '#2a9bb5', '#7b8794',
];

export const DEFAULT_TAGS: [string, string][] = [
  ['先行研究', '#4f7cff'],
  ['仮説・問い', '#8a63d2'],
  ['実験計画', '#2a9bb5'],
  ['実験プログラム', '#e8833a'],
  ['実験結果', '#2fa36b'],
  ['考察', '#c94f7c'],
  ['指導・議論', '#c9a227'],
  ['メモ', '#7b8794'],
];

export function emptyDB(): DB {
  return { version: 1, currentProjectId: null, projects: {} };
}

export function newProject(name: string, description = ''): Project {
  const mainId = uid();
  const tags: Record<ID, Tag> = {};
  const tagOrder: ID[] = [];
  for (const [n, c] of DEFAULT_TAGS) {
    const id = uid();
    tags[id] = { id, name: n, color: c };
    tagOrder.push(id);
  }
  return {
    id: uid(),
    name,
    description,
    commits: {},
    branches: {
      [mainId]: { id: mainId, name: 'main', baseId: null, headId: null, status: 'active', note: '', createdAt: now() },
    },
    tags,
    tagOrder,
    tasks: {},
    taskSeq: 0,
    milestones: {},
    reports: {},
    currentBranchId: mainId,
    createdAt: now(),
  };
}

/** 古い形式のデータに新しい項目を補う（読み込み時に呼ぶ） */
export function normalizeProject(p: Project): Project {
  p.tasks ??= {};
  p.milestones ??= {};
  p.reports ??= {};
  p.taskSeq ??= Object.values(p.tasks).reduce((m, t) => Math.max(m, t.number), 0);
  for (const c of Object.values(p.commits)) {
    c.mergeParentId ??= null;
    c.taskIds ??= [];
    c.ref ??= null;
    c.results ??= [];
  }
  return p;
}

export function normalizeDB(d: DB): DB {
  for (const p of Object.values(d.projects ?? {})) normalizeProject(p);
  return d;
}

// ---------- 参照系ヘルパ ----------

/** root → commitId までの祖先列（自身を含む） */
export function lineage(p: Project, commitId: ID | null): Commit[] {
  const out: Commit[] = [];
  const seen = new Set<ID>();
  let cur = commitId ? p.commits[commitId] : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? p.commits[cur.parentId] : undefined;
  }
  return out.reverse();
}

/** 統合（merge）元もたどった祖先すべて（作成順）。論文構成に使う */
export function fullLineage(p: Project, commitId: ID | null): Commit[] {
  const seen = new Map<ID, Commit>();
  const stack = commitId ? [commitId] : [];
  while (stack.length) {
    const id = stack.pop()!;
    const c = p.commits[id];
    if (!c || seen.has(id)) continue;
    seen.set(id, c);
    if (c.parentId) stack.push(c.parentId);
    if (c.mergeParentId) stack.push(c.mergeParentId);
  }
  return topoOrder(p, new Set(seen.keys()));
}

/**
 * 記録を「ロジックの順番」に並べる（前の記録 → 後の記録の順を必ず守る）。
 * 並べ替えで後から差し込んだ記録は作成日時が新しくても、つながり上の位置に表示される。
 * 並べ替えをしていなければ作成順と同じになる。subset を渡すとその記録だけを並べる。
 */
export function topoOrder(p: Project, subset?: Set<ID>): Commit[] {
  const list = Object.values(p.commits).filter((c) => !subset || subset.has(c.id));
  const ids = new Set(list.map((c) => c.id));
  // 子（前の記録 = parentId でつながるもの）
  const kids = new Map<ID, Commit[]>();
  for (const c of list) {
    if (c.parentId && ids.has(c.parentId)) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
  }
  // 並び順の基準: 自分と後に続く記録のうち、いちばん早い作成日時
  const key = new Map<ID, string>();
  const keyOf = (c: Commit, guard = new Set<ID>()): string => {
    const k = key.get(c.id);
    if (k) return k;
    if (guard.has(c.id)) return c.createdAt; // 循環の保険
    guard.add(c.id);
    let m = c.createdAt;
    for (const ch of kids.get(c.id) ?? []) { const ck = keyOf(ch, guard); if (ck < m) m = ck; }
    key.set(c.id, m);
    return m;
  };
  for (const c of list) keyOf(c);
  // Kahn 法: 前の記録がすべて出たものの中から、基準が早い順に出す
  const indeg = new Map<ID, number>(list.map((c) => [c.id, 0]));
  const next = new Map<ID, ID[]>();
  for (const c of list) {
    for (const par of [c.parentId, c.mergeParentId]) {
      if (par && ids.has(par)) {
        indeg.set(c.id, indeg.get(c.id)! + 1);
        next.set(par, [...(next.get(par) ?? []), c.id]);
      }
    }
  }
  const cmp = (a: Commit, b: Commit) =>
    key.get(a.id)!.localeCompare(key.get(b.id)!) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const ready = list.filter((c) => indeg.get(c.id) === 0);
  const out: Commit[] = [];
  while (ready.length) {
    ready.sort(cmp);
    const c = ready.shift()!;
    out.push(c);
    for (const nid of next.get(c.id) ?? []) {
      const d = indeg.get(nid)! - 1;
      indeg.set(nid, d);
      if (d === 0) ready.push(p.commits[nid]);
    }
  }
  return out; // 循環があると list より短くなる
}

export function childrenMap(p: Project): Map<ID, Commit[]> {
  const m = new Map<ID, Commit[]>();
  for (const c of Object.values(p.commits)) {
    if (!c.parentId) continue;
    const arr = m.get(c.parentId) ?? [];
    arr.push(c);
    m.set(c.parentId, arr);
  }
  return m;
}

/** ブランチ固有のコミット（分岐点より後） */
export function ownCommits(p: Project, b: Branch): Commit[] {
  const path = lineage(p, b.headId);
  if (!b.baseId) return path;
  const idx = path.findIndex((c) => c.id === b.baseId);
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function sortedBranches(p: Project): Branch[] {
  return Object.values(p.branches).sort((a, b) => {
    if (a.baseId === null && b.baseId !== null) return -1;
    if (b.baseId === null && a.baseId !== null) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function branchesAtHead(p: Project, commitId: ID): Branch[] {
  return sortedBranches(p).filter((b) => b.headId === commitId);
}

export function matchesFilter(
  c: Commit,
  tagFilter: ID[],
  query: string,
  tagMode: 'any' | 'all',
): boolean {
  if (tagFilter.length) {
    const ok = tagMode === 'all'
      ? tagFilter.every((t) => c.tagIds.includes(t))
      : tagFilter.some((t) => c.tagIds.includes(t));
    if (!ok) return false;
  }
  const q = query.trim().toLowerCase();
  if (q) {
    const hay = (c.title + '\n' + c.body + '\n' + c.links.join('\n')).toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }
  return true;
}

export function taskMatches(t: Task, tagFilter: ID[], query: string, tagMode: 'any' | 'all'): boolean {
  if (tagFilter.length) {
    const ok = tagMode === 'all' ? tagFilter.every((x) => t.tagIds.includes(x)) : tagFilter.some((x) => t.tagIds.includes(x));
    if (!ok) return false;
  }
  const q = query.trim().toLowerCase();
  if (q) {
    const hay = (t.title + '\n' + t.body + '\n#' + t.number).toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }
  return true;
}

export const isOpenTask = (t: Task) => t.status === 'todo' || t.status === 'doing';

/** 今日の日付（YYYY-MM-DD, ローカル時刻） */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 日付までの日数（今日 = 0、過ぎていれば負） */
export function daysUntil(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const [ty, tm, td] = today().split('-').map(Number);
  return Math.round((target - new Date(ty, tm - 1, td).getTime()) / 86400000);
}

// ---------- 更新系（Project を受け取り新しい Project を返す） ----------

/** プロジェクトを書き換える操作。label は「元に戻す」の表示に使う */
export type Mut = ((p: Project) => void) & { label?: string };

export interface CommitInput {
  title: string;
  body: string;
  tagIds: ID[];
  links: string[];
  taskIds: ID[];
  ref: Reference | null;
  results: ResultItem[];
}

export interface TaskInput {
  title: string;
  body: string;
  tagIds: ID[];
  due: string | null;
  milestoneId: ID | null;
  status: TaskStatus;
}

function setTaskStatus(t: Task, status: TaskStatus) {
  if (t.status === status) return;
  t.status = status;
  t.updatedAt = now();
  t.closedAt = status === 'done' || status === 'dropped' ? now() : null;
}

const rawOps = {
  /** closeTasks: 紐づけたタスクを完了にする */
  commit(input: CommitInput, onNewId?: (id: ID) => void, closeTasks = false): Mut {
    return (p) => {
      const b = p.branches[p.currentBranchId];
      const id = uid();
      const t = now();
      p.commits[id] = { id, parentId: b.headId, mergeParentId: null, branchId: b.id, ...input, createdAt: t, updatedAt: t };
      b.headId = id;
      for (const tid of input.taskIds) {
        const task = p.tasks[tid];
        if (!task) continue;
        if (closeTasks) setTaskStatus(task, 'done');
        else if (task.status === 'todo') setTaskStatus(task, 'doing');
      }
      onNewId?.(id);
    };
  },
  /** ブランチ fromId の成果を現在のブランチへ統合する記録を作る */
  merge(fromId: ID, title: string, body: string, markMerged: boolean, onNewId?: (id: ID) => void): Mut {
    return (p) => {
      const into = p.branches[p.currentBranchId];
      const from = p.branches[fromId];
      if (!from || from.id === into.id) throw new Error('統合するブランチを選んでください');
      if (!from.headId) throw new Error(`ブランチ「${from.name}」にはまだ記録がありません`);
      if (fullLineage(p, into.headId).some((c) => c.id === from.headId))
        throw new Error(`ブランチ「${from.name}」の内容はすでに「${into.name}」に含まれています`);
      const id = uid();
      const t = now();
      p.commits[id] = {
        id, parentId: into.headId, mergeParentId: from.headId, branchId: into.id, title, body,
        tagIds: [], links: [], taskIds: [], ref: null, results: [], createdAt: t, updatedAt: t,
      };
      into.headId = id;
      if (markMerged) from.status = 'merged';
      onNewId?.(id);
    };
  },
  editCommit(id: ID, input: Partial<CommitInput>): Mut {
    return (p) => {
      const c = p.commits[id];
      if (!c) return;
      const oldTitle = c.title;
      Object.assign(c, input, { updatedAt: now() });
      // 他の記録からの [[旧タイトル]] リンクを追従させる
      if (input.title !== undefined) renameWikiLinks(p, oldTitle, input.title);
    };
  },
  /**
   * 記録を削除する。途中の記録でもよく、後ろの記録・分岐・ブランチの先端は、ひとつ前の記録へつなぎ直す。
   * 統合の記録を消した場合、取り込んだ側のブランチは「進行中」に戻す。
   */
  deleteCommit(id: ID): Mut {
    return (p) => {
      const c = p.commits[id];
      if (!c) return;
      const P = c.parentId;
      // 最初の記録から別のブランチが分かれていると、つなぎ先がなくなる
      if (!P && Object.values(p.branches).some((b) => b.baseId === id))
        throw new Error('この記録から別のブランチが分岐しているため、最初の記録は削除できません（先に分岐したブランチを削除するか、記録を移動してください）');
      const mergedFrom = c.mergeParentId ? p.commits[c.mergeParentId]?.branchId : null;
      for (const x of Object.values(p.commits)) {
        if (x.parentId === id) x.parentId = P;
        if (x.mergeParentId === id) x.mergeParentId = P;
      }
      for (const b of Object.values(p.branches)) {
        if (b.headId === id) b.headId = P;
        if (b.baseId === id) b.baseId = P;
      }
      for (const t of Object.values(p.tasks)) if (t.sourceCommitId === id) t.sourceCommitId = null;
      delete p.commits[id];
      // 統合の記録だった場合: 取り込んだ側のブランチを戻す
      const fb = mergedFrom ? p.branches[mergedFrom] : null;
      if (fb && fb.status === 'merged') {
        const own = new Set(ownCommits(p, fb).map((x) => x.id));
        if (!Object.values(p.commits).some((x) => x.mergeParentId && own.has(x.mergeParentId))) fb.status = 'active';
      }
    };
  },
  branchFrom(commitId: ID, name: string, note: string): Mut {
    return (p) => {
      const id = uid();
      p.branches[id] = { id, name, baseId: commitId, headId: commitId, status: 'active', note, createdAt: now() };
      p.currentBranchId = id;
    };
  },
  checkout(branchId: ID): Mut {
    return (p) => { if (p.branches[branchId]) p.currentBranchId = branchId; };
  },
  editBranch(id: ID, patch: Partial<Pick<Branch, 'name' | 'note' | 'status'>>): Mut {
    return (p) => { Object.assign(p.branches[id], patch); };
  },
  setBranchStatus(id: ID, status: BranchStatus): Mut {
    return (p) => { p.branches[id].status = status; };
  },
  /** ブランチと、そのブランチ固有のコミットを削除 */
  deleteBranch(id: ID): Mut {
    return (p) => {
      const b = p.branches[id];
      if (!b || b.baseId === null) throw new Error('main ブランチは削除できません');
      const own = new Set(ownCommits(p, b).map((c) => c.id));
      for (const other of Object.values(p.branches)) {
        if (other.id === id) continue;
        if (other.headId && own.has(other.headId))
          throw new Error(`ブランチ「${other.name}」がこのブランチのコミットから分岐しているため削除できません`);
      }
      for (const c of Object.values(p.commits)) {
        if (!own.has(c.id) && c.mergeParentId && own.has(c.mergeParentId))
          throw new Error('このブランチは別のブランチに統合されているため削除できません');
      }
      for (const cid of own) delete p.commits[cid];
      for (const t of Object.values(p.tasks)) {
        if (t.branchId === id) t.branchId = null;
        if (t.sourceCommitId && own.has(t.sourceCommitId)) t.sourceCommitId = null;
      }
      delete p.branches[id];
      if (p.currentBranchId === id) p.currentBranchId = sortedBranches(p)[0].id;
    };
  },
  addTag(name: string, color: string): Mut {
    return (p) => {
      const id = uid();
      p.tags[id] = { id, name, color };
      p.tagOrder.push(id);
    };
  },
  editTag(id: ID, patch: Partial<Pick<Tag, 'name' | 'color'>>): Mut {
    return (p) => { Object.assign(p.tags[id], patch); };
  },
  deleteTag(id: ID): Mut {
    return (p) => {
      delete p.tags[id];
      p.tagOrder = p.tagOrder.filter((t) => t !== id);
      for (const c of Object.values(p.commits)) c.tagIds = c.tagIds.filter((t) => t !== id);
    };
  },
  editProject(patch: Partial<Pick<Project, 'name' | 'description'>>): Mut {
    return (p) => { Object.assign(p, patch); };
  },

  // ---------- タスク ----------
  addTask(input: TaskInput, extra: { sourceCommitId?: ID | null; branchId?: ID | null } = {}, onNewId?: (id: ID) => void): Mut {
    return (p) => {
      const id = uid();
      const t = now();
      p.taskSeq += 1;
      p.tasks[id] = {
        id, number: p.taskSeq, ...input, branchId: extra.branchId ?? null, sourceCommitId: extra.sourceCommitId ?? null,
        createdAt: t, updatedAt: t, closedAt: input.status === 'done' || input.status === 'dropped' ? t : null,
      };
      onNewId?.(id);
    };
  },
  editTask(id: ID, input: Partial<TaskInput>): Mut {
    return (p) => {
      const t = p.tasks[id];
      if (!t) return;
      const { status, ...rest } = input;
      Object.assign(t, rest, { updatedAt: now() });
      if (status) setTaskStatus(t, status);
    };
  },
  setTaskStatus(id: ID, status: TaskStatus): Mut {
    return (p) => { if (p.tasks[id]) setTaskStatus(p.tasks[id], status); };
  },
  /** ブランチに関連する未完了タスクをまとめて見送りにする */
  dropBranchTasks(branchId: ID): Mut {
    return (p) => {
      for (const t of Object.values(p.tasks)) if (t.branchId === branchId && isOpenTask(t)) setTaskStatus(t, 'dropped');
    };
  },
  deleteTask(id: ID): Mut {
    return (p) => {
      delete p.tasks[id];
      for (const c of Object.values(p.commits)) c.taskIds = c.taskIds.filter((x) => x !== id);
    };
  },
  /** タスクのためのブランチを fromCommitId から始める */
  branchForTask(taskId: ID, fromCommitId: ID, name: string, note: string): Mut {
    return (p) => {
      const id = uid();
      p.branches[id] = { id, name, baseId: fromCommitId, headId: fromCommitId, status: 'active', note, createdAt: now() };
      p.currentBranchId = id;
      const t = p.tasks[taskId];
      if (t) { t.branchId = id; if (t.status === 'todo') setTaskStatus(t, 'doing'); }
    };
  },

  // ---------- マイルストーン ----------
  addMilestone(m: Omit<Milestone, 'id'>): Mut {
    return (p) => { const id = uid(); p.milestones[id] = { id, ...m }; };
  },
  editMilestone(id: ID, patch: Partial<Omit<Milestone, 'id'>>): Mut {
    return (p) => { if (p.milestones[id]) Object.assign(p.milestones[id], patch); };
  },
  // ---------- 進捗報告 ----------
  saveReport(r: Omit<SavedReport, 'id' | 'createdAt' | 'updatedAt'>, id?: ID | null, onId?: (id: ID) => void): Mut {
    return (p) => {
      const t = now();
      if (id && p.reports[id]) {
        Object.assign(p.reports[id], r, { updatedAt: t });
        onId?.(id);
      } else {
        const nid = uid();
        p.reports[nid] = { id: nid, ...r, createdAt: t, updatedAt: t };
        onId?.(nid);
      }
    };
  },
  deleteReport(id: ID): Mut {
    return (p) => { delete p.reports[id]; };
  },

  deleteMilestone(id: ID): Mut {
    return (p) => {
      delete p.milestones[id];
      for (const t of Object.values(p.tasks)) if (t.milestoneId === id) t.milestoneId = null;
    };
  },

  /**
   * 記録 id を、記録 afterId の直後へ移動する（afterId が null なら main の先頭へ）。
   * 元の位置では、前後の記録をつなぎ直す。移動した記録は移動先のブランチに属する。
   */
  moveCommit(id: ID, afterId: ID | null): Mut {
    return (p) => {
      const x = p.commits[id];
      if (!x) throw new Error('記録が見つかりません');
      if (afterId === id) return;
      if (afterId && !p.commits[afterId]) throw new Error('移動先の記録が見つかりません');
      const P = x.parentId;
      // 分岐の起点になっている最初の記録は、つなぎ先がなくなるので動かせない
      if (!P && Object.values(p.branches).some((b) => b.baseId === id))
        throw new Error('ブランチの分岐元になっている最初の記録は移動できません');

      // 1) 元の位置から外す（後ろの記録・分岐・ブランチの先端を、ひとつ前の記録へつなぎ直す）
      for (const c of Object.values(p.commits)) {
        if (c.parentId === id) c.parentId = P;
        if (c.mergeParentId === id) c.mergeParentId = P;
      }
      for (const b of Object.values(p.branches)) {
        if (b.headId === id) b.headId = P;
        if (b.baseId === id) b.baseId = P;
      }

      // 2) 移動先に差し込む
      if (afterId) {
        const y = p.commits[afterId];
        // 移動先のブランチで、y の次に続いていた記録
        const cont = Object.values(p.commits)
          .filter((c) => c.parentId === y.id && c.branchId === y.branchId && c.id !== id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        x.parentId = y.id;
        x.branchId = y.branchId;
        if (cont) cont.parentId = id;
        const yb = p.branches[y.branchId];
        if (yb && yb.headId === y.id) yb.headId = id;
      } else {
        const main = Object.values(p.branches).find((b) => b.baseId === null);
        if (!main) throw new Error('main ブランチが見つかりません');
        const root = topoOrder(p).find((c) => c.branchId === main.id && !c.parentId && c.id !== id);
        x.parentId = null;
        x.branchId = main.id;
        if (root) root.parentId = id;
        if (!main.headId) main.headId = id;
      }
      x.updatedAt = now();

      // 3) つながりが循環していないか確認（循環するならこの操作は取りやめ）
      if (topoOrder(p).length !== Object.keys(p.commits).length)
        throw new Error('その位置には移動できません（前後関係が循環してしまいます）');
    };
  },

  /**
   * 統合（merge）を取り消す。
   * 統合の記録が末端なら記録ごと削除し、後に記録が続いていれば統合のつながりだけ外して普通の記録に戻す。
   * 取り込んだ側のブランチが「統合済み」なら「進行中」に戻す。
   */
  unmerge(commitId: ID): Mut {
    return (p) => {
      const c = p.commits[commitId];
      if (!c || !c.mergeParentId) throw new Error('この記録は統合の記録ではありません');
      const fromBranchId = p.commits[c.mergeParentId]?.branchId;
      const hasFollowers = Object.values(p.commits).some((x) => x.parentId === commitId || x.mergeParentId === commitId)
        || Object.values(p.branches).some((b) => b.baseId === commitId);
      if (hasFollowers) {
        c.mergeParentId = null;
        c.updatedAt = now();
      } else {
        for (const b of Object.values(p.branches)) if (b.headId === commitId) b.headId = c.parentId;
        for (const t of Object.values(p.tasks)) if (t.sourceCommitId === commitId) t.sourceCommitId = null;
        delete p.commits[commitId];
      }
      const fb = fromBranchId ? p.branches[fromBranchId] : null;
      if (fb && fb.status === 'merged') {
        const own = new Set(ownCommits(p, fb).map((x) => x.id));
        const stillMerged = Object.values(p.commits).some((x) => x.mergeParentId && own.has(x.mergeParentId));
        if (!stillMerged) fb.status = 'active';
      }
    };
  },
};

const OP_LABELS: Record<string, string> = {
  commit: '記録の追加', editCommit: '記録の編集', deleteCommit: '記録の削除', moveCommit: '記録の移動', merge: 'ブランチの統合', unmerge: '統合の取り消し',
  branchFrom: 'ブランチの作成', checkout: 'ブランチの切り替え', editBranch: 'ブランチの編集', setBranchStatus: 'ブランチの状態変更',
  deleteBranch: 'ブランチの削除', addTag: 'タグの追加', editTag: 'タグの編集', deleteTag: 'タグの削除', editProject: 'プロジェクトの編集',
  addTask: 'タスクの追加', editTask: 'タスクの編集', setTaskStatus: 'タスクの状態変更', dropBranchTasks: 'タスクの見送り',
  deleteTask: 'タスクの削除', branchForTask: 'タスクのブランチ作成', addMilestone: 'マイルストーンの追加',
  editMilestone: 'マイルストーンの編集', deleteMilestone: 'マイルストーンの削除', saveReport: '進捗報告の保存', deleteReport: '進捗報告の削除',
};

/** 各操作に「元に戻す」で表示する名前を付ける */
function withLabels<T extends Record<string, (...args: any[]) => Mut>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(o)) {
    out[k] = (...args: unknown[]) => {
      const m = (f as (...a: unknown[]) => Mut)(...args);
      m.label = OP_LABELS[k] ?? k;
      return m;
    };
  }
  return out as T;
}

export const ops = withLabels(rawOps);

// ---------- 永続化フック ----------

const LS_KEY = 'research-branch-db';
export type SaveState = 'loading' | 'saved' | 'saving' | 'local-only' | 'error';

export function useDB() {
  const [db, setDb] = useState<DB | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const serverOk = useRef(true);
  const timer = useRef<number | undefined>(undefined);
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      let data: DB | null = null;
      try {
        const r = await fetch('/api/db');
        if (!r.ok) throw new Error(String(r.status));
        data = await r.json();
      } catch {
        serverOk.current = false;
      }
      if (!data) {
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (raw) data = JSON.parse(raw);
        } catch { /* ignore */ }
      }
      const initial = normalizeDB(data ?? emptyDB());
      lastSaved.current = JSON.stringify(initial);
      setDb(initial);
      setSaveState(serverOk.current ? 'saved' : 'local-only');
    })();
  }, []);

  useEffect(() => {
    if (!db) return;
    const json = JSON.stringify(db);
    if (json === lastSaved.current) return;
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      lastSaved.current = json;
      try { localStorage.setItem(LS_KEY, json); } catch { /* ignore */ }
      if (!serverOk.current) { setSaveState('local-only'); return; }
      try {
        const r = await fetch('/api/db', { method: 'PUT', body: json, headers: { 'Content-Type': 'application/json' } });
        setSaveState(r.ok ? 'saved' : 'error');
      } catch {
        setSaveState('error');
      }
    }, 400);
  }, [db]);

  const dbRef = useRef<DB | null>(null);
  dbRef.current = db;

  // ---------- 元に戻す / やり直す ----------
  // 状態は書き換えずに新しいオブジェクトを作っているので、過去の DB をそのまま履歴として持てる
  type Entry = { db: DB; label: string; at: number };
  const past = useRef<Entry[]>([]);
  const future = useRef<Entry[]>([]);
  const HISTORY_MAX = 200;

  /** DB を置き換える。label を付けると「元に戻す」の対象になる（プロジェクトの切り替えなどは付けない） */
  const replace = useCallback((next: DB, label?: string) => {
    const prev = dbRef.current;
    if (label && prev) {
      const last = past.current[past.current.length - 1];
      const now = Date.now();
      // タグ名の入力のように同じ操作が続けて起きたときは、1回の「元に戻す」にまとめる
      if (last && last.label === label && now - last.at < 1000 && !future.current.length) {
        last.at = now;
      } else {
        past.current.push({ db: prev, label, at: now });
        if (past.current.length > HISTORY_MAX) past.current.shift();
      }
      future.current = [];
    }
    dbRef.current = next;
    setDb(next);
  }, []);

  /** 現在のプロジェクトを変更。エラー時は message を返す */
  const update = useCallback((mut: Mut): string | null => {
    const prev = dbRef.current;
    if (!prev || !prev.currentProjectId) return 'プロジェクトが選択されていません';
    const p = structuredClone(prev.projects[prev.currentProjectId]);
    try {
      mut(p);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    replace({ ...prev, projects: { ...prev.projects, [p.id]: p } }, mut.label ?? '変更');
    return null;
  }, [replace]);

  /** 戻した操作の名前を返す（何もなければ null） */
  const undo = useCallback((): string | null => {
    const e = past.current.pop();
    const cur = dbRef.current;
    if (!e || !cur) return null;
    future.current.push({ db: cur, label: e.label, at: 0 });
    dbRef.current = e.db;
    setDb(e.db);
    return e.label;
  }, []);

  const redo = useCallback((): string | null => {
    const e = future.current.pop();
    const cur = dbRef.current;
    if (!e || !cur) return null;
    past.current.push({ db: cur, label: e.label, at: 0 });
    dbRef.current = e.db;
    setDb(e.db);
    return e.label;
  }, []);

  const history = {
    undoLabel: past.current.length ? past.current[past.current.length - 1].label : null,
    redoLabel: future.current.length ? future.current[future.current.length - 1].label : null,
  };

  return { db, replace, update, saveState, undo, redo, history };
}
