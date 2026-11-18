export type ID = string;

export interface Tag {
  id: ID;
  name: string;
  color: string;
}

/** 文献情報（先行研究の記録に付ける） */
export interface Reference {
  key: string; // BibTeX のキー（例: billa2026cascade）
  type: string; // article / inproceedings / misc など
  authors: string; // "A and B and C"
  year: string;
  title: string;
  venue: string; // 会議名・論文誌名
  doi: string;
  url: string;
}

/** 条件・結果の値（実験比較表に使う） */
export interface ResultItem {
  key: string;
  value: string;
}

/** 研究の1ステップ（git の commit に相当） */
export interface Commit {
  id: ID;
  parentId: ID | null;
  /** ブランチの統合（merge）で取り込んだ側の先端 */
  mergeParentId: ID | null;
  /** このコミットが作られたブランチ（グラフのレーン決定に使う） */
  branchId: ID;
  title: string;
  body: string; // Markdown
  tagIds: ID[];
  links: string[]; // URL / DOI / ファイルパスなど
  /** この記録で取り組んだタスク */
  taskIds: ID[];
  ref: Reference | null;
  results: ResultItem[];
  createdAt: string;
  updatedAt: string;
}

/** 進行中 / 採用 / 棄却（出戻りで捨てた筋）/ 統合済み */
export type BranchStatus = 'active' | 'adopted' | 'abandoned' | 'merged';

export interface Branch {
  id: ID;
  name: string;
  /** 分岐元のコミット（main は null） */
  baseId: ID | null;
  headId: ID | null;
  status: BranchStatus;
  note: string; // 分岐の理由など
  createdAt: string;
}

export type TaskStatus = 'todo' | 'doing' | 'done' | 'dropped';

/** これからやること（GitHub の Issue に相当） */
export interface Task {
  id: ID;
  number: number; // #1, #2 …
  title: string;
  body: string;
  status: TaskStatus;
  tagIds: ID[];
  due: string | null; // YYYY-MM-DD
  milestoneId: ID | null;
  /** このタスクのために始めたブランチ */
  branchId: ID | null;
  /** このタスクを作るきっかけになった記録 */
  sourceCommitId: ID | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** 締切・節目（学会締切、中間発表など） */
export interface Milestone {
  id: ID;
  title: string;
  date: string; // YYYY-MM-DD
  description: string;
}

/** 保存した進捗報告（週報・月報など） */
export interface SavedReport {
  id: ID;
  title: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  body: string; // Markdown
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: ID;
  name: string;
  description: string;
  commits: Record<ID, Commit>;
  branches: Record<ID, Branch>;
  tags: Record<ID, Tag>;
  tagOrder: ID[];
  tasks: Record<ID, Task>;
  taskSeq: number;
  milestones: Record<ID, Milestone>;
  reports: Record<ID, SavedReport>;
  currentBranchId: ID;
  createdAt: string;
}

export interface DB {
  version: 1;
  currentProjectId: ID | null;
  projects: Record<ID, Project>;
}
