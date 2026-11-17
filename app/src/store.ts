import { useCallback, useEffect, useRef, useState } from 'react';
import type { Branch, BranchStatus, Commit, DB, ID, Project, Tag } from './types';
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
    currentBranchId: mainId,
    createdAt: now(),
  };
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

// ---------- 更新系（Project を受け取り新しい Project を返す） ----------

type Mut = (p: Project) => void;

export interface CommitInput {
  title: string;
  body: string;
  tagIds: ID[];
  links: string[];
}

export const ops = {
  commit(input: CommitInput, onNewId?: (id: ID) => void): Mut {
    return (p) => {
      const b = p.branches[p.currentBranchId];
      const id = uid();
      const t = now();
      p.commits[id] = { id, parentId: b.headId, branchId: b.id, ...input, createdAt: t, updatedAt: t };
      b.headId = id;
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
  /** 末端のコミットのみ削除可能 */
  deleteCommit(id: ID): Mut {
    return (p) => {
      const c = p.commits[id];
      if (!c) return;
      if (Object.values(p.commits).some((x) => x.parentId === id))
        throw new Error('子コミットがあるため削除できません（末端のコミットのみ削除できます）');
      if (Object.values(p.branches).some((b) => b.baseId === id && b.headId === id))
        throw new Error('このコミットから分岐したブランチがあるため削除できません');
      for (const b of Object.values(p.branches)) if (b.headId === id) b.headId = c.parentId;
      delete p.commits[id];
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
      for (const cid of own) delete p.commits[cid];
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
};

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
      const initial = data ?? emptyDB();
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

  /** 現在のプロジェクトを変更。エラー時は message を返す */
  const dbRef = useRef<DB | null>(null);
  dbRef.current = db;

  const replace = useCallback((next: DB) => {
    dbRef.current = next;
    setDb(next);
  }, []);

  const update = useCallback((mut: Mut): string | null => {
    const prev = dbRef.current;
    if (!prev || !prev.currentProjectId) return 'プロジェクトが選択されていません';
    const p = structuredClone(prev.projects[prev.currentProjectId]);
    try {
      mut(p);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    replace({ ...prev, projects: { ...prev.projects, [p.id]: p } });
    return null;
  }, [replace]);

  return { db, replace, update, saveState };
}
