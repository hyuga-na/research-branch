export type ID = string;

export interface Tag {
  id: ID;
  name: string;
  color: string;
}

/** 研究の1ステップ（git の commit に相当） */
export interface Commit {
  id: ID;
  parentId: ID | null;
  /** このコミットが作られたブランチ（グラフのレーン決定に使う） */
  branchId: ID;
  title: string;
  body: string; // Markdown
  tagIds: ID[];
  links: string[]; // URL / DOI / ファイルパスなど
  createdAt: string;
  updatedAt: string;
}

/** 採用中 / 保留 / 棄却（出戻りで捨てた筋） */
export type BranchStatus = 'active' | 'adopted' | 'abandoned';

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

export interface Project {
  id: ID;
  name: string;
  description: string;
  commits: Record<ID, Commit>;
  branches: Record<ID, Branch>;
  tags: Record<ID, Tag>;
  tagOrder: ID[];
  currentBranchId: ID;
  createdAt: string;
}

export interface DB {
  version: 1;
  currentProjectId: ID | null;
  projects: Record<ID, Project>;
}
