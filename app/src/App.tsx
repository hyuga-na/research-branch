import { useEffect, useMemo, useRef, useState } from 'react';
import { findByTitle } from './wiki';
import type { Branch, BranchStatus, DB, ID, Milestone, Project } from './types';
import { daysUntil, fullLineage, isOpenTask, newProject, normalizeDB, ops, ownCommits, sortedBranches, TAG_COLORS, useDB } from './store';
import { MilestoneDialog, nextMilestone, TaskDetail, TaskEditor, TasksView } from './components/Tasks';
import { ReportView } from './components/Report';
import { sampleProject } from './sample';
import { Graph } from './components/Graph';
import { Sidebar } from './components/Sidebar';
import { CommitDetail, CommitEditor } from './components/DetailPanel';
import { ListView } from './components/ListView';
import { Outline } from './components/Outline';
import { ConfirmDialog, Modal, STATUS_LABEL, WikiContext, type AskConfirm, type ConfirmRequest } from './components/ui';

type View = 'graph' | 'list' | 'tasks' | 'outline' | 'report';
type Panel =
  | { kind: 'none' }
  | { kind: 'detail'; id: ID }
  | { kind: 'new'; taskIds?: ID[] }
  | { kind: 'edit'; id: ID }
  | { kind: 'task'; id: ID }
  | { kind: 'newTask'; sourceCommitId?: ID }
  | { kind: 'editTask'; id: ID };
type Dialog =
  | { kind: 'none' }
  | { kind: 'branch'; from: ID }
  | { kind: 'editBranch'; branch: Branch }
  | { kind: 'tags' }
  | { kind: 'newProject' }
  | { kind: 'project' }
  | { kind: 'milestone'; milestone?: Milestone }
  | { kind: 'merge'; fromId?: ID }
  | { kind: 'taskBranch'; taskId: ID; from: ID };

export default function App() {
  const { db, replace, update, saveState, undo, redo, history } = useDB();
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

  const doUndo = () => { const l = undo(); flash(l ? `元に戻しました: ${l}` : '元に戻せる操作はありません'); };
  const doRedo = () => { const l = redo(); flash(l ? `やり直しました: ${l}` : 'やり直せる操作はありません'); };
  const keyActions = useRef({ doUndo, doRedo });
  keyActions.current = { doUndo, doRedo };

  // Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z）。文字入力中やダイアログ表示中は、ブラウザ本来の取り消しに任せる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const isUndo = k === 'z' && !e.shiftKey;
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
      if (!isUndo && !isRedo) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-backdrop')) return;
      e.preventDefault();
      if (isUndo) keyActions.current.doUndo(); else keyActions.current.doRedo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const undoButtons = (
    <span className="undo-group">
      <button className="icon-btn" onClick={doUndo} disabled={!history.undoLabel}
        title={history.undoLabel ? `元に戻す: ${history.undoLabel}（Ctrl+Z）` : '元に戻す（Ctrl+Z）'} aria-label="元に戻す">↶</button>
      <button className="icon-btn" onClick={doRedo} disabled={!history.redoLabel}
        title={history.redoLabel ? `やり直す: ${history.redoLabel}（Ctrl+Y）` : 'やり直す（Ctrl+Y）'} aria-label="やり直す">↷</button>
    </span>
  );

  if (!db) return <div className="loading">読み込み中…</div>;

  const addProject = (p: Project) => {
    replace({ ...db, currentProjectId: p.id, projects: { ...db.projects, [p.id]: p } }, 'プロジェクトの追加');
  };

  if (!project) {
    return (
      <Welcome
        db={db}
        onCreate={() => setDialog({ kind: 'newProject' })}
        onSample={() => addProject(sampleProject())}
        onOpen={(id) => replace({ ...db, currentProjectId: id })}
        onImport={(d) => replace(normalizeDB(d), 'JSON の読み込み')}
        undoSlot={history.undoLabel ? <button className="btn" onClick={doUndo}>↶ 元に戻す: {history.undoLabel}</button> : null}
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
  const openTask = (id: ID) => setPanel({ kind: 'task', id });
  /** 統合の取り消し（確認つき）。統合の記録が末端なら削除、後に続く記録があればつながりだけ外す */
  const unmerge = async (mergeCommitId: ID) => {
    const c = project.commits[mergeCommitId];
    if (!c?.mergeParentId) return;
    const fromName = project.branches[project.commits[c.mergeParentId]?.branchId]?.name ?? '?';
    const hasFollowers = Object.values(project.commits).some((x) => x.parentId === c.id || x.mergeParentId === c.id)
      || Object.values(project.branches).some((b) => b.baseId === c.id);
    const ok = await askConfirm(`「${fromName}」の統合を取り消しますか？`, {
      detail: hasFollowers
        ? 'この後にも記録が続いているため、記録「' + c.title + '」は残し、統合のつながりだけを外します。'
        : '統合の記録「' + c.title + '」を削除し、統合する前の状態に戻します。',
      okLabel: '統合を取り消す',
    });
    if (!ok) return;
    if (run(ops.unmerge(c.id))) {
      if (!hasFollowers) setPanel({ kind: 'none' });
      flash(`「${fromName}」の統合を取り消しました（Ctrl+Z で元に戻せます）`);
    }
  };
  /** このブランチを取り込んだ統合の記録（新しい順） */
  const mergesOf = (b: Branch) => {
    const own = new Set(ownCommits(project, b).map((c) => c.id));
    return Object.values(project.commits).filter((c) => c.mergeParentId && own.has(c.mergeParentId)).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  };
  const nextMs = nextMilestone(project);
  const openCount = Object.values(project.tasks).filter(isOpenTask).length;

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
        defaultTaskIds={panel.taskIds}
        onSubmit={(input, closeTasks) => {
          let newId: ID | null = null;
          if (run(ops.commit(input, (id) => { newId = id; }, closeTasks))) {
            if (newId) setPanel({ kind: 'detail', id: newId });
            flash(closeTasks && input.taskIds.length ? '記録し、タスクを完了にしました' : '記録しました');
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
        onSubmit={(input, closeTasks) => {
          if (!run(ops.editCommit(id, input))) return;
          if (closeTasks) for (const t of input.taskIds) run(ops.setTaskStatus(t, 'done'));
          setPanel({ kind: 'detail', id });
        }}
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
        onNewTask={() => setPanel({ kind: 'newTask', sourceCommitId: c.id })}
        onOpenTask={openTask}
        onUnmerge={() => unmerge(c.id)}
      />
    );
  } else if (panel.kind === 'task' && project.tasks[panel.id]) {
    const t = project.tasks[panel.id];
    side = (
      <TaskDetail
        project={project}
        task={t}
        onEdit={() => setPanel({ kind: 'editTask', id: t.id })}
        onStatus={(st) => { if (run(ops.setTaskStatus(t.id, st))) flash(`#${t.number} を「${({ todo: '未着手', doing: '進行中', done: '完了', dropped: '見送り' })[st]}」にしました`); }}
        onRecord={() => setPanel({ kind: 'new', taskIds: [t.id] })}
        onBranch={() => {
          const from = (t.sourceCommitId && project.commits[t.sourceCommitId] ? t.sourceCommitId : null) ?? current.headId;
          if (!from) { flash('まだ記録がないため、ブランチを始められません'); return; }
          setDialog({ kind: 'taskBranch', taskId: t.id, from });
        }}
        onDelete={async () => {
          if (!(await askConfirm(`タスク #${t.number}「${t.title}」を削除しますか？`, { detail: '完了や見送りにすると履歴として残せます。削除は取り消せません。', okLabel: '削除', danger: true }))) return;
          if (run(ops.deleteTask(t.id))) setPanel({ kind: 'none' });
        }}
        onSelectCommit={select}
        onCheckout={checkout}
      />
    );
  } else if (panel.kind === 'newTask') {
    const src = panel.sourceCommitId ? project.commits[panel.sourceCommitId] : null;
    side = (
      <TaskEditor
        key={'newtask-' + (panel.sourceCommitId ?? '')}
        project={project}
        heading="＋ タスクを作る"
        initial={src ? { tagIds: [] } : undefined}
        sub={src ? <>きっかけの記録: <i>{src.title}</i></> : undefined}
        onSubmit={(input) => {
          let newId: ID | null = null;
          if (run(ops.addTask(input, { sourceCommitId: src?.id ?? null }, (id) => { newId = id; }))) {
            if (newId) setPanel({ kind: 'task', id: newId });
            flash('タスクを作りました');
          }
        }}
        onCancel={() => setPanel(src ? { kind: 'detail', id: src.id } : { kind: 'none' })}
      />
    );
  } else if (panel.kind === 'editTask' && project.tasks[panel.id]) {
    const id = panel.id;
    side = (
      <TaskEditor
        key={'edittask-' + id}
        project={project}
        heading={`タスク #${project.tasks[id].number} を編集`}
        initial={project.tasks[id]}
        onSubmit={(input) => { if (run(ops.editTask(id, input))) setPanel({ kind: 'task', id }); }}
        onCancel={() => setPanel({ kind: 'task', id })}
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
          <button className={view === 'tasks' ? 'on' : ''} onClick={() => setView('tasks')}>
            タスク{openCount > 0 && <span className="tab-count">{openCount}</span>}
          </button>
          <button className={view === 'outline' ? 'on' : ''} onClick={() => setView('outline')}>論文構成</button>
          <button className={view === 'report' ? 'on' : ''} onClick={() => setView('report')}>進捗報告</button>
        </nav>
        <input
          className="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="キーワード検索"
          aria-label="キーワード検索"
        />
        {undoButtons}
        <span className={`save save-${saveState}`}>
          {{ loading: '…', saved: '保存済み', saving: '保存中…', 'local-only': 'ブラウザ内に保存', error: '保存エラー' }[saveState]}
        </span>
        {nextMs && (
          <button className={`ms-pill${daysUntil(nextMs.date) <= 14 ? ' soon' : ''}`} onClick={() => setView('tasks')} title={`${nextMs.title}（${nextMs.date.replace(/-/g, '/')}）`}>
            🏁 {nextMs.title.length > 14 ? nextMs.title.slice(0, 14) + '…' : nextMs.title} {daysUntil(nextMs.date) === 0 ? '今日' : `あと${daysUntil(nextMs.date)}日`}
          </button>
        )}
        <div className="head-branch" title="現在のブランチ（新しい記録はここに追加されます）">
          <span className="muted">HEAD:</span> <b>{current.name}</b>
        </div>
        <button className="btn primary" onClick={() => setPanel({ kind: 'new' })}>＋ 記録する</button>
      </header>

      <div className="body">
        {(view === 'graph' || view === 'list' || view === 'tasks') && (
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
            onMerge={() => setDialog({ kind: 'merge' })}
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
          {view === 'tasks' && (
            <TasksView
              project={project}
              tagFilter={tagFilter}
              tagMode={tagMode}
              query={query}
              selectedId={panel.kind === 'task' || panel.kind === 'editTask' ? panel.id : null}
              onOpen={openTask}
              onNew={() => setPanel({ kind: 'newTask' })}
              onNewMilestone={() => setDialog({ kind: 'milestone' })}
              onEditMilestone={(m) => setDialog({ kind: 'milestone', milestone: m })}
            />
          )}
          {view === 'outline' && <Outline key={project.id} project={project} onSelect={select} />}
          {view === 'report' && (
            <ReportView
              key={project.id}
              project={project}
              onSave={(r, id) => {
                let saved: ID | null = null;
                if (run(ops.saveReport(r, id, (x) => { saved = x; }))) flash('進捗報告を保存しました');
                return saved;
              }}
              onDelete={async (id) => {
                const r = project.reports[id];
                if (await askConfirm(`「${r?.title}」を削除しますか？`, { detail: 'この操作は取り消せません。', okLabel: '削除', danger: true })) run(ops.deleteReport(id));
              }}
            />
          )}
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
          onSubmit={async (name, note, status) => {
            const b = dialog.branch;
            if (!run(ops.editBranch(b.id, { name, note, status }))) return;
            setDialog({ kind: 'none' });
            const related = Object.values(project.tasks).filter((t) => t.branchId === b.id && isOpenTask(t));
            if (status === 'abandoned' && b.status !== 'abandoned' && related.length) {
              if (await askConfirm(`このブランチに関連する未完了のタスクが ${related.length} 件あります。「見送り」にしますか？`, { detail: related.map((t) => `#${t.number} ${t.title}`).join(' / '), okLabel: '見送りにする' })) {
                run(ops.dropBranchTasks(b.id));
                flash(`タスク ${related.length} 件を見送りにしました`);
              }
            }
          }}
          onMerge={dialog.branch.id !== project.currentBranchId && dialog.branch.headId ? () => setDialog({ kind: 'merge', fromId: dialog.branch.id }) : undefined}
          mergedInto={mergesOf(dialog.branch)[0] ? project.branches[mergesOf(dialog.branch)[0].branchId]?.name : undefined}
          onUnmerge={mergesOf(dialog.branch)[0] ? () => { const m = mergesOf(dialog.branch)[0]; setDialog({ kind: 'none' }); unmerge(m.id); } : undefined}
          currentName={current.name}
          onDelete={dialog.branch.baseId ? async () => {
            const b = dialog.branch;
            setDialog({ kind: 'none' });
            if (!(await askConfirm(`ブランチ「${b.name}」を削除しますか？`, { detail: 'このブランチだけにある記録も一緒に削除されます。この操作は取り消せません。', okLabel: '削除', danger: true }))) return;
            if (run(ops.deleteBranch(b.id))) setPanel({ kind: 'none' });
          } : undefined}
        />
      )}
      {dialog.kind === 'taskBranch' && project.tasks[dialog.taskId] && (
        <BranchDialog
          title="タスクのためのブランチを始める"
          defaultName={`#${project.tasks[dialog.taskId].number} ${project.tasks[dialog.taskId].title}`.slice(0, 40)}
          defaultNote={project.tasks[dialog.taskId].title}
          fromTitle={project.commits[dialog.from]?.title}
          onClose={() => setDialog({ kind: 'none' })}
          onSubmit={(name, note) => {
            if (run(ops.branchForTask(dialog.taskId, dialog.from, name, note))) {
              setDialog({ kind: 'none' });
              setPanel({ kind: 'new', taskIds: [dialog.taskId] });
              flash(`ブランチ「${name}」を作成しました。このタスクの記録はこのブランチに追加されます`);
            }
          }}
        />
      )}
      {dialog.kind === 'merge' && (
        <MergeDialog
          project={project}
          initialFromId={dialog.fromId}
          into={current}
          onClose={() => setDialog({ kind: 'none' })}
          onSubmit={(fromId, title, body, markMerged) => {
            let newId: ID | null = null;
            if (run(ops.merge(fromId, title, body, markMerged, (id) => { newId = id; }))) {
              setDialog({ kind: 'none' });
              if (newId) setPanel({ kind: 'detail', id: newId });
              flash(`「${project.branches[fromId].name}」を「${current.name}」に統合しました`);
            }
          }}
        />
      )}
      {dialog.kind === 'milestone' && (
        <MilestoneDialog
          initial={dialog.milestone}
          onClose={() => setDialog({ kind: 'none' })}
          onSubmit={(m) => {
            const ok = dialog.milestone ? run(ops.editMilestone(dialog.milestone.id, m)) : run(ops.addMilestone(m));
            if (ok) setDialog({ kind: 'none' });
          }}
          onDelete={dialog.milestone ? async () => {
            const m = dialog.milestone!;
            setDialog({ kind: 'none' });
            if (await askConfirm(`マイルストーン「${m.title}」を削除しますか？`, { detail: '紐づいたタスクは残り、マイルストーンの指定だけが外れます。', okLabel: '削除', danger: true })) run(ops.deleteMilestone(m.id));
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
            replace(normalizeDB(d), 'JSON の読み込み');
            flash('読み込みました');
          }}
          onDelete={async () => {
            const target = project;
            setDialog({ kind: 'none' });
            const n = Object.keys(target.commits).length;
            if (!(await askConfirm(`プロジェクト「${target.name}」を削除しますか？`, { detail: `記録 ${n} 件とブランチがすべて削除されます。この操作は取り消せません。`, okLabel: '削除', danger: true }))) return;
            const rest = { ...db.projects };
            delete rest[target.id];
            replace({ ...db, projects: rest, currentProjectId: Object.keys(rest)[0] ?? null }, 'プロジェクトの削除');
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

function BranchDialog({ title, initial, defaultName, defaultNote, fromTitle, onClose, onSubmit, onDelete, onMerge, currentName, mergedInto, onUnmerge }: {
  title: string;
  initial?: Branch;
  defaultName?: string;
  defaultNote?: string;
  fromTitle?: string;
  onClose: () => void;
  onSubmit: (name: string, note: string, status: BranchStatus) => void;
  onDelete?: () => void;
  onMerge?: () => void;
  currentName?: string;
  /** このブランチを取り込んだ先のブランチ名 */
  mergedInto?: string;
  onUnmerge?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? defaultName ?? '');
  const [note, setNote] = useState(initial?.note ?? defaultNote ?? '');
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
              {(['active', 'adopted', 'abandoned', 'merged'] as BranchStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
        )}
        {onMerge && (
          <div className="merge-box">
            <button type="button" className="btn" onClick={onMerge}>⇄ 現在のブランチ「{currentName}」に統合…</button>
            <p className="hint">このブランチの成果を、いま記録しているブランチに取り込みます（git の merge）。論文構成では両方の記録が並びます。</p>
          </div>
        )}
        {onUnmerge && (
          <div className="merge-box">
            <button type="button" className="btn" onClick={onUnmerge}>↩ 「{mergedInto}」への統合を取り消す</button>
            <p className="hint">統合をなかったことにして、このブランチを統合前の状態に戻します。</p>
          </div>
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

function MergeDialog({ project: p, initialFromId, into, onClose, onSubmit }: {
  project: Project;
  initialFromId?: ID;
  into: Branch;
  onClose: () => void;
  onSubmit: (fromId: ID, title: string, body: string, markMerged: boolean) => void;
}) {
  // 統合できるブランチ: 現在のブランチ以外で、記録があり、まだ取り込んでいないもの
  const included = new Set(fullLineage(p, into.headId).map((c) => c.id));
  const candidates = sortedBranches(p).filter((b) => b.id !== into.id && b.headId && !included.has(b.headId));
  const [fromId, setFromId] = useState<ID>(initialFromId && candidates.some((b) => b.id === initialFromId) ? initialFromId : candidates[0]?.id ?? '');
  const from = p.branches[fromId];
  const defaultTitle = (b?: Branch) => (b ? `「${b.name}」の成果を統合` : '');
  const [title, setTitle] = useState(defaultTitle(from));
  const [body, setBody] = useState('');
  const [markMerged, setMarkMerged] = useState(true);
  if (!from) {
    return (
      <Modal title="ブランチを統合（merge）" onClose={onClose}>
        <p>現在のブランチ「{into.name}」に統合できるブランチがありません。</p>
        <p className="hint">統合は「いま記録しているブランチ」に、別のブランチの成果を取り込む操作です。取り込む先のブランチに切り替えてから（サイドバーでクリック）、もう一度開いてください。</p>
        <div className="editor-actions"><button className="btn" onClick={onClose}>閉じる</button></div>
      </Modal>
    );
  }
  return (
    <Modal title="ブランチを統合（merge）" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (title.trim()) onSubmit(fromId, title.trim(), body, markMerged); }}>
        <label className="field">
          <span>取り込むブランチ</span>
          <select value={fromId} onChange={(e) => {
            const next = p.branches[e.target.value];
            if (title === defaultTitle(from)) setTitle(defaultTitle(next));
            setFromId(e.target.value);
          }}>
            {candidates.map((b) => <option key={b.id} value={b.id}>{b.name}（{STATUS_LABEL[b.status]}）</option>)}
          </select>
        </label>
        <p className="merge-flow"><b>{from.name}</b> <span className="muted">→</span> <b>{into.name}</b>（現在のブランチ）</p>
        <p className="hint">取り込む先を変えたいときは、先にサイドバーでそのブランチに切り替えてください。</p>
        <label className="field"><span>統合の記録のタイトル</span><input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label className="field">
          <span>何を取り込んだか・なぜ統合するか（任意）</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="例: バッチサイズの検討結果（128 で十分）を本線の設定に反映する" />
        </label>
        <label className="check"><input type="checkbox" checked={markMerged} onChange={(e) => setMarkMerged(e.target.checked)} />「{from.name}」の状態を「統合済み」にする</label>
        <div className="editor-actions">
          <button type="button" className="btn ghost" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn primary" disabled={!title.trim()}>統合する</button>
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

function Welcome({ db, onCreate, onSample, onOpen, onImport, undoSlot, dialog }: {
  db: DB;
  onCreate: () => void;
  onSample: () => void;
  onOpen: (id: ID) => void;
  onImport: (d: DB) => void;
  undoSlot: React.ReactNode;
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
        {undoSlot && <div className="row-gap">{undoSlot}</div>}
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
