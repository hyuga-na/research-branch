import { useEffect, useMemo, useRef, useState } from 'react';
import { findByTitle } from './wiki';
import type { Branch, BranchStatus, DB, ID, Project } from './types';
import { newProject, ops, sortedBranches, TAG_COLORS, useDB } from './store';
import { sampleProject } from './sample';
import { Graph } from './components/Graph';
import { Sidebar } from './components/Sidebar';
import { CommitDetail, CommitEditor } from './components/DetailPanel';
import { ListView } from './components/ListView';
import { Outline } from './components/Outline';
import { ConfirmDialog, Modal, STATUS_LABEL, WikiContext, type AskConfirm, type ConfirmRequest } from './components/ui';

type View = 'graph' | 'list' | 'outline';
type Panel = { kind: 'none' } | { kind: 'detail'; id: ID } | { kind: 'new' } | { kind: 'edit'; id: ID };
type Dialog =
  | { kind: 'none' }
  | { kind: 'branch'; from: ID }
  | { kind: 'editBranch'; branch: Branch }
  | { kind: 'tags' }
  | { kind: 'newProject' }
  | { kind: 'project' };

export default function App() {
  const { db, replace, update, saveState } = useDB();
  const [view, setView] = useState<View>('graph');
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [tagFilter, setTagFilter] = useState<ID[]>([]);
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any');
  const [query, setQuery] = useState('');
  const [hideAbandoned, setHideAbandoned] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const askConfirm: AskConfirm = (message, opts = {}) =>
    new Promise((resolve) => setConfirmReq({ message, ...opts, resolve }));

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  };
  const run = (mut: Parameters<typeof update>[0]) => {
    const err = update(mut);
    if (err) flash(err);
    return !err;
  };

  const project = db?.currentProjectId ? db.projects[db.currentProjectId] : null;
  const wikiValue = useMemo(() => ({
    resolve: (title: string) => (project ? findByTitle(project, title)?.id ?? null : null),
    open: (id: ID) => setPanel({ kind: 'detail', id }),
  }), [project]);

  useEffect(() => {
    setPanel({ kind: 'none' });
    setTagFilter([]);
    setQuery('');
  }, [db?.currentProjectId]);

  if (!db) return <div className="loading">読み込み中…</div>;

  const addProject = (p: Project) => {
    replace({ ...db, currentProjectId: p.id, projects: { ...db.projects, [p.id]: p } });
  };

  if (!project) {
    return (
      <Welcome
        db={db}
        onCreate={() => setDialog({ kind: 'newProject' })}
        onSample={() => addProject(sampleProject())}
        onOpen={(id) => replace({ ...db, currentProjectId: id })}
        onImport={(d) => replace(d)}
        dialog={dialog.kind === 'newProject' ? (
          <NewProjectDialog onClose={() => setDialog({ kind: 'none' })} onCreate={(n, d) => { addProject(newProject(n, d)); setDialog({ kind: 'none' }); }} />
        ) : null}
      />
    );
  }

  const current = project.branches[project.currentBranchId];
  const select = (id: ID) => setPanel({ kind: 'detail', id });
  const checkout = (id: ID) => {
    run(ops.checkout(id));
    flash(`ブランチ「${project.branches[id].name}」に切り替えました`);
  };
  const headCommit = current.headId ? project.commits[current.headId] : null;

  let side: React.ReactNode = null;
  if (panel.kind === 'new') {
    side = (
      <CommitEditor
        key={'new-' + current.id}
        project={project}
        heading="＋ 記録する（commit）"
        sub={<>
          ブランチ <b>{current.name}</b> に追加 ・ 前のステップ: {headCommit ? <i>{headCommit.title}</i> : <span className="muted">なし（最初の記録）</span>}
        </>}
        submitLabel="記録する"
        onSubmit={(input) => {
          let newId: ID | null = null;
          if (run(ops.commit(input, (id) => { newId = id; }))) {
            if (newId) setPanel({ kind: 'detail', id: newId });
            flash('記録しました');
          }
        }}
        onCancel={() => setPanel({ kind: 'none' })}
      />
    );
  } else if (panel.kind === 'edit' && project.commits[panel.id]) {
    const id = panel.id;
    side = (
      <CommitEditor
        key={'edit-' + id}
        project={project}
        initial={project.commits[id]}
        heading="記録を編集"
        submitLabel="保存"
        onSubmit={(input) => { if (run(ops.editCommit(id, input))) setPanel({ kind: 'detail', id }); }}
        onCancel={() => setPanel({ kind: 'detail', id })}
      />
    );
  } else if (panel.kind === 'detail' && project.commits[panel.id]) {
    const c = project.commits[panel.id];
    side = (
      <CommitDetail
        project={project}
        commit={c}
        onEdit={() => setPanel({ kind: 'edit', id: c.id })}
        onBranch={() => setDialog({ kind: 'branch', from: c.id })}
        onDelete={async () => {
          if (!(await askConfirm(`記録「${c.title}」を削除しますか？`, { detail: 'この操作は取り消せません。', okLabel: '削除', danger: true }))) return;
          if (run(ops.deleteCommit(c.id))) setPanel({ kind: 'none' });
        }}
        onSelect={select}
        onCheckout={checkout}
      />
    );
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `research-branch-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <WikiContext.Provider value={wikiValue}>
    <div className="app">
      <header className="topbar">
        <div className="brand" title="Research Branch">⑂ Research Branch</div>
        <select
          className="project-select"
          value={project.id}
          onChange={(e) => {
            if (e.target.value === '__new') setDialog({ kind: 'newProject' });
            else if (e.target.value === '__sample') addProject(sampleProject());
            else replace({ ...db, currentProjectId: e.target.value });
          }}
          aria-label="プロジェクト"
        >
          {Object.values(db.projects).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__new">＋ 新しいプロジェクト…</option>
          <option value="__sample">＋ サンプルプロジェクトを追加</option>
        </select>
        <button className="icon-btn" onClick={() => setDialog({ kind: 'project' })} title="プロジェクト設定" aria-label="プロジェクト設定">⚙</button>
        <nav className="tabs">
          <button className={view === 'graph' ? 'on' : ''} onClick={() => setView('graph')}>グラフ</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>一覧・検索</button>
          <button className={view === 'outline' ? 'on' : ''} onClick={() => setView('outline')}>論文構成</button>
        </nav>
        <input
          className="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="キーワード検索"
          aria-label="キーワード検索"
        />
        <span className={`save save-${saveState}`}>
          {{ loading: '…', saved: '保存済み', saving: '保存中…', 'local-only': 'ブラウザ内に保存', error: '保存エラー' }[saveState]}
        </span>
        <div className="head-branch" title="現在のブランチ（新しい記録はここに追加されます）">
          <span className="muted">HEAD:</span> <b>{current.name}</b>
        </div>
        <button className="btn primary" onClick={() => setPanel({ kind: 'new' })}>＋ 記録する</button>
      </header>

      <div className="body">
        {view !== 'outline' && (
          <Sidebar
            project={project}
            onCheckout={checkout}
            onEditBranch={(b) => setDialog({ kind: 'editBranch', branch: b })}
            tagFilter={tagFilter}
            setTagFilter={setTagFilter}
            tagMode={tagMode}
            setTagMode={setTagMode}
            hideAbandoned={hideAbandoned}
            setHideAbandoned={setHideAbandoned}
            onAddTag={(n, c) => run(ops.addTag(n, c))}
            onEditTags={() => setDialog({ kind: 'tags' })}
          />
        )}
        <main className="main">
          {view === 'graph' && (
            <Graph
              project={project}
              selectedId={panel.kind === 'detail' || panel.kind === 'edit' ? panel.id : null}
              onSelect={select}
              onCheckout={checkout}
              tagFilter={tagFilter}
              tagMode={tagMode}
              query={query}
              hideAbandoned={hideAbandoned}
            />
          )}
          {view === 'list' && (
            <ListView
              project={project}
              tagFilter={tagFilter}
              tagMode={tagMode}
              query={query}
              selectedId={panel.kind === 'detail' ? panel.id : null}
              onSelect={select}
            />
          )}
          {view === 'outline' && <Outline key={project.id} project={project} onSelect={select} />}
        </main>
        {side && (
          <aside className="panel">
            <button className="icon-btn panel-close" onClick={() => setPanel({ kind: 'none' })} aria-label="パネルを閉じる" title="閉じる">×</button>
            {side}
          </aside>
        )}
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}

      {dialog.kind === 'branch' && (
        <BranchDialog
          title="ここから分岐"
          fromTitle={project.commits[dialog.from]?.title}
          onClose={() => setDialog({ kind: 'none' })}
          onSubmit={(name, note) => {
            if (run(ops.branchFrom(dialog.from, name, note))) {
              setDialog({ kind: 'none' });
              setPanel({ kind: 'new' });
              flash(`ブランチ「${name}」を作成しました。続きの記録はこのブランチに追加されます`);
            }
          }}
        />
      )}
      {dialog.kind === 'editBranch' && (
        <BranchDialog
          title="ブランチを編集"
          initial={dialog.branch}
          fromTitle={dialog.branch.baseId ? project.commits[dialog.branch.baseId]?.title : undefined}
          onClose={() => setDialog({ kind: 'none' })}
          onSubmit={(name, note, status) => {
            if (run(ops.editBranch(dialog.branch.id, { name, note, status }))) setDialog({ kind: 'none' });
          }}
          onDelete={dialog.branch.baseId ? async () => {
            const b = dialog.branch;
            setDialog({ kind: 'none' });
            if (!(await askConfirm(`ブランチ「${b.name}」を削除しますか？`, { detail: 'このブランチだけにある記録も一緒に削除されます。この操作は取り消せません。', okLabel: '削除', danger: true }))) return;
            if (run(ops.deleteBranch(b.id))) setPanel({ kind: 'none' });
          } : undefined}
        />
      )}
      {dialog.kind === 'tags' && <TagsDialog project={project} run={run} askConfirm={askConfirm} onClose={() => setDialog({ kind: 'none' })} />}
      {dialog.kind === 'newProject' && (
        <NewProjectDialog onClose={() => setDialog({ kind: 'none' })} onCreate={(n, d) => { addProject(newProject(n, d)); setDialog({ kind: 'none' }); }} />
      )}
      {dialog.kind === 'project' && (
        <ProjectDialog
          project={project}
          onClose={() => setDialog({ kind: 'none' })}
          onSave={(name, description) => { run(ops.editProject({ name, description })); setDialog({ kind: 'none' }); }}
          onExport={exportJson}
          onImport={async (d) => {
            setDialog({ kind: 'none' });
            if (!(await askConfirm('現在のデータを読み込んだ JSON で置き換えますか？', { detail: '今あるプロジェクトはすべて置き換わります。先に「JSON を書き出す」でバックアップを取っておくと安全です。', okLabel: '置き換える', danger: true }))) return;
            replace(d);
            flash('読み込みました');
          }}
          onDelete={async () => {
            const target = project;
            setDialog({ kind: 'none' });
            const n = Object.keys(target.commits).length;
            if (!(await askConfirm(`プロジェクト「${target.name}」を削除しますか？`, { detail: `記録 ${n} 件とブランチがすべて削除されます。この操作は取り消せません。`, okLabel: '削除', danger: true }))) return;
            const rest = { ...db.projects };
            delete rest[target.id];
            replace({ ...db, projects: rest, currentProjectId: Object.keys(rest)[0] ?? null });
            flash(`プロジェクト「${target.name}」を削除しました`);
          }}
        />
      )}
      {confirmReq && <ConfirmDialog req={confirmReq} onDone={() => setConfirmReq(null)} />}
    </div>
    </WikiContext.Provider>
  );
}

// ---------- ダイアログ類 ----------

function BranchDialog({ title, initial, fromTitle, onClose, onSubmit, onDelete }: {
  title: string;
  initial?: Branch;
  fromTitle?: string;
  onClose: () => void;
  onSubmit: (name: string, note: string, status: BranchStatus) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [status, setStatus] = useState<BranchStatus>(initial?.status ?? 'active');
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim(), note.trim(), status); }}>
        {fromTitle && <p className="muted">分岐元: <b>{fromTitle}</b></p>}
        <label className="field">
          <span>ブランチ名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 案B: 自己教師あり学習" required />
        </label>
        <label className="field">
          <span>分岐の理由・メモ（論文構成の「検討した別の筋」に表示されます）</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="例: 案Aの改善幅が小さかったため方針転換" />
        </label>
        {initial && (
          <label className="field">
            <span>状態</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as BranchStatus)}>
              {(['active', 'adopted', 'abandoned'] as BranchStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
        )}
        <div className="editor-actions">
          {onDelete && <button type="button" className="btn danger-ghost" onClick={onDelete}>ブランチを削除</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>{initial ? '保存' : '分岐する'}</button>
        </div>
      </form>
    </Modal>
  );
}

function TagsDialog({ project: p, run, askConfirm, onClose }: { project: Project; run: (m: Parameters<ReturnType<typeof useDB>['update']>[0]) => boolean; askConfirm: AskConfirm; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Modal title="タグを管理" onClose={onClose}>
      <ul className="tag-edit">
        {p.tagOrder.map((id) => {
          const t = p.tags[id];
          if (!t) return null;
          return (
            <li key={id}>
              <input type="color" value={t.color} onChange={(e) => run(ops.editTag(id, { color: e.target.value }))} aria-label={`${t.name} の色`} />
              <input value={t.name} onChange={(e) => run(ops.editTag(id, { name: e.target.value }))} aria-label="タグ名" />
              <button
                className="icon-btn sm"
                onClick={async () => {
                  if (await askConfirm(`タグ「${t.name}」を削除しますか？`, { detail: 'このタグは各記録からも外れます（記録自体は残ります）。', okLabel: '削除', danger: true })) run(ops.deleteTag(id));
                }}
                aria-label={`${t.name} を削除`}
              >🗑</button>
            </li>
          );
        })}
      </ul>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { run(ops.addTag(name.trim(), TAG_COLORS[p.tagOrder.length % TAG_COLORS.length])); setName(''); } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新しいタグ名" />
        <button className="btn sm" type="submit">追加</button>
      </form>
      <p className="hint">論文構成の「タグ別に章立て」では、この並び順で章が作られます。</p>
    </Modal>
  );
}

function NewProjectDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, desc: string) => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  return (
    <Modal title="新しいプロジェクト" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), desc.trim()); }}>
        <label className="field"><span>研究テーマ名</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>説明（任意）</span><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} /></label>
        <p className="hint">「先行研究」「実験プログラム」などの基本タグが自動で用意されます。</p>
        <div className="editor-actions">
          <button type="button" className="btn ghost" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>作成</button>
        </div>
      </form>
    </Modal>
  );
}

function readDBFile(file: File, cb: (d: DB) => void, onErr: (m: string) => void) {
  file.text().then((t) => {
    const d = JSON.parse(t);
    if (!d || d.version !== 1 || typeof d.projects !== 'object') throw new Error('形式が違います');
    cb(d as DB);
  }).catch((e) => onErr(`読み込めませんでした: ${e instanceof Error ? e.message : e}`));
}

function ProjectDialog({ project: p, onClose, onSave, onExport, onImport, onDelete }: {
  project: Project;
  onClose: () => void;
  onSave: (name: string, desc: string) => void;
  onExport: () => void;
  onImport: (d: DB) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description);
  const [err, setErr] = useState('');
  const commits = Object.keys(p.commits).length;
  return (
    <Modal title="プロジェクト設定" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim(), desc.trim()); }}>
        <label className="field"><span>研究テーマ名</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>説明</span><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} /></label>
        <p className="muted small">記録 {commits} 件 ・ ブランチ {sortedBranches(p).length} 本</p>
        <div className="editor-actions">
          <button type="submit" className="btn primary">保存</button>
        </div>
      </form>
      <hr />
      <div className="form">
        <h4>バックアップ</h4>
        <p className="hint">全プロジェクトを JSON で書き出し／読み込みできます。読み込むと現在のデータは置き換わります。</p>
        <div className="row-gap">
          <button className="btn" onClick={onExport}>JSON を書き出す</button>
          <label className="btn">
            JSON を読み込む
            <input type="file" accept="application/json,.json" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readDBFile(f, onImport, setErr);
              e.target.value = '';
            }} />
          </label>
        </div>
        {err && <p className="error">{err}</p>}
        <hr />
        <button className="btn danger-ghost" onClick={onDelete}>このプロジェクトを削除</button>
      </div>
    </Modal>
  );
}

function Welcome({ db, onCreate, onSample, onOpen, onImport, dialog }: {
  db: DB;
  onCreate: () => void;
  onSample: () => void;
  onOpen: (id: ID) => void;
  onImport: (d: DB) => void;
  dialog: React.ReactNode;
}) {
  const [err, setErr] = useState('');
  const projects = Object.values(db.projects);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>⑂ Research Branch</h1>
        <p>
          研究のステップ（先行研究のサーベイ、実験プログラム、結果、考察…）を <b>commit</b> のように順番に記録し、
          出戻りが起きたらその地点から <b>branch</b> を切って新しい筋を伸ばせます。
          最後に採用した筋を上から辿れば、そのまま論文の構成になります。
        </p>
        <div className="row-gap">
          <button className="btn primary" onClick={onCreate}>新しいプロジェクトを作る</button>
          <button className="btn" onClick={onSample}>サンプルを見てみる</button>
          <label className="btn ghost">
            JSON を読み込む
            <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readDBFile(f, onImport, setErr); }} />
          </label>
        </div>
        {err && <p className="error">{err}</p>}
        {projects.length > 0 && (
          <ul className="welcome-list">
            {projects.map((p) => <li key={p.id}><button className="link-btn" onClick={() => onOpen(p.id)}>{p.name}</button></li>)}
          </ul>
        )}
      </div>
      {dialog}
    </div>
  );
}
