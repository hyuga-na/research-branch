import { useState } from 'react';
import type { ID, Milestone, Project, Task, TaskStatus } from '../types';
import { daysUntil, isOpenTask, taskMatches, today, type TaskInput } from '../store';
import { branchColorMap } from '../graph';
import { DueLabel, fmtDate, Markdown, Modal, StatusBadge, TagChip, TASK_STATUS_LABEL, TaskStatusBadge } from './ui';

type StatusFilter = 'open' | 'done' | 'dropped' | 'all';

export function milestoneProgress(p: Project, m: Milestone) {
  const ts = Object.values(p.tasks).filter((t) => t.milestoneId === m.id && t.status !== 'dropped');
  const done = ts.filter((t) => t.status === 'done').length;
  return { done, total: ts.length };
}

export function sortedMilestones(p: Project): Milestone[] {
  return Object.values(p.milestones).sort((a, b) => a.date.localeCompare(b.date));
}

/** 今日以降でいちばん近いマイルストーン */
export function nextMilestone(p: Project): Milestone | null {
  const t = today();
  return sortedMilestones(p).find((m) => m.date >= t) ?? null;
}

function MilestoneCard({ p, m, onEdit }: { p: Project; m: Milestone; onEdit: () => void }) {
  const { done, total } = milestoneProgress(p, m);
  const d = daysUntil(m.date);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <button className={`ms-card${d < 0 ? ' past' : d <= 14 ? ' soon' : ''}`} onClick={onEdit} title="クリックで編集">
      <div className="ms-top">
        <b>{m.title}</b>
        <span className="ms-days">{d === 0 ? '今日' : d > 0 ? `あと ${d} 日` : `${-d} 日前`}</span>
      </div>
      <div className="muted small">{m.date.replace(/-/g, '/')}</div>
      <div className="bar" aria-label={`タスク ${done}/${total} 完了`}><div style={{ width: `${pct}%` }} /></div>
      <div className="muted small">タスク {done} / {total} 完了</div>
    </button>
  );
}

function TaskRow({ p, t, selected, onOpen }: { p: Project; t: Task; selected: boolean; onOpen: () => void }) {
  const records = Object.values(p.commits).filter((c) => c.taskIds.includes(t.id)).length;
  const ms = t.milestoneId ? p.milestones[t.milestoneId] : null;
  const branch = t.branchId ? p.branches[t.branchId] : null;
  return (
    <li>
      <button className={`task-item${selected ? ' sel' : ''}${isOpenTask(t) ? '' : ' closed'}`} onClick={onOpen}>
        <TaskStatusBadge status={t.status} />
        <span className="task-num">#{t.number}</span>
        <span className="task-title">{t.title}</span>
        <span className="task-meta">
          {t.tagIds.map((id) => p.tags[id] && <TagChip key={id} tag={p.tags[id]} small />)}
          {ms && <span className="ms-chip" title="マイルストーン">🏁 {ms.title}</span>}
          {branch && <span className="muted small">⑂ {branch.name}</span>}
          {records > 0 && <span className="muted small" title="取り組んだ記録の数">📝 {records}</span>}
          {t.due && <DueLabel date={t.due} done={!isOpenTask(t)} />}
        </span>
      </button>
    </li>
  );
}

export function TasksView({ project: p, tagFilter, tagMode, query, selectedId, onOpen, onNew, onEditMilestone, onNewMilestone }: {
  project: Project;
  tagFilter: ID[];
  tagMode: 'any' | 'all';
  query: string;
  selectedId: ID | null;
  onOpen: (id: ID) => void;
  onNew: () => void;
  onEditMilestone: (m: Milestone) => void;
  onNewMilestone: () => void;
}) {
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [byMilestone, setByMilestone] = useState(true);
  const all = Object.values(p.tasks);
  const count = (f: StatusFilter) => all.filter((t) => statusOk(t.status, f)).length;
  const items = all
    .filter((t) => statusOk(t.status, filter) && taskMatches(t, tagFilter, query, tagMode))
    .sort((a, b) => {
      // 進行中 → 期限が近い順 → 番号順
      const so = (t: Task) => (t.status === 'doing' ? 0 : 1);
      return so(a) - so(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.number - b.number;
    });
  const milestones = sortedMilestones(p);

  const groups: { key: string; label: React.ReactNode; items: Task[] }[] = [];
  if (byMilestone && milestones.length) {
    for (const m of milestones) {
      const its = items.filter((t) => t.milestoneId === m.id);
      if (its.length) groups.push({ key: m.id, label: <>🏁 {m.title} <span className="muted small">{m.date.replace(/-/g, '/')}</span></>, items: its });
    }
    const rest = items.filter((t) => !t.milestoneId || !p.milestones[t.milestoneId]);
    if (rest.length) groups.push({ key: '_none', label: <span className="muted">マイルストーンなし</span>, items: rest });
  } else {
    groups.push({ key: 'all', label: null, items });
  }

  return (
    <div className="tasks-view">
      <section className="ms-section">
        <div className="section-head">
          <h3>マイルストーン（締切・節目）</h3>
          <button className="btn sm" onClick={onNewMilestone}>＋ マイルストーン</button>
        </div>
        {milestones.length === 0 ? (
          <p className="muted small">学会締切・中間発表・ゼミ発表などを登録すると、残り日数とタスクの進み具合が表示されます。</p>
        ) : (
          <div className="ms-cards">{milestones.map((m) => <MilestoneCard key={m.id} p={p} m={m} onEdit={() => onEditMilestone(m)} />)}</div>
        )}
      </section>

      <div className="list-toolbar">
        <div className="seg">
          {(['open', 'done', 'dropped', 'all'] as StatusFilter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {{ open: '未完了', done: '完了', dropped: '見送り', all: 'すべて' }[f]} {count(f)}
            </button>
          ))}
        </div>
        {milestones.length > 0 && (
          <label className="check"><input type="checkbox" checked={byMilestone} onChange={(e) => setByMilestone(e.target.checked)} />マイルストーンごとにまとめる</label>
        )}
        <span className="spacer" />
        <button className="btn primary sm" onClick={onNew}>＋ タスク</button>
      </div>

      {all.length === 0 ? (
        <div className="empty">
          <p>まだタスクがありません。</p>
          <p className="muted">「＋ タスク」や、記録の詳細の「この記録からタスクを作る」から追加できます。<br />指導教員に言われたことや、考察で出てきた「次にやること」を残しておきましょう。</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty"><p>条件に合うタスクはありません。</p></div>
      ) : groups.map((g) => (
        <section key={g.key} className="list-group">
          {g.label && <h3 className="list-group-head">{g.label}<span className="muted small">{g.items.length}</span></h3>}
          <ul className="list">{g.items.map((t) => <TaskRow key={t.id} p={p} t={t} selected={selectedId === t.id} onOpen={() => onOpen(t.id)} />)}</ul>
        </section>
      ))}
    </div>
  );
}

function statusOk(s: TaskStatus, f: StatusFilter) {
  if (f === 'all') return true;
  if (f === 'open') return s === 'todo' || s === 'doing';
  return s === f;
}

// ---------- タスク詳細（右パネル） ----------

export function TaskDetail({ project: p, task: t, onEdit, onStatus, onRecord, onBranch, onDelete, onSelectCommit, onCheckout }: {
  project: Project;
  task: Task;
  onEdit: () => void;
  onStatus: (s: TaskStatus) => void;
  onRecord: () => void;
  onBranch: () => void;
  onDelete: () => void;
  onSelectCommit: (id: ID) => void;
  onCheckout: (id: ID) => void;
}) {
  const colors = branchColorMap(p);
  const records = Object.values(p.commits).filter((c) => c.taskIds.includes(t.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const source = t.sourceCommitId ? p.commits[t.sourceCommitId] : null;
  const branch = t.branchId ? p.branches[t.branchId] : null;
  const ms = t.milestoneId ? p.milestones[t.milestoneId] : null;
  return (
    <div className="detail">
      <div className="detail-meta">
        <span className="task-num">タスク #{t.number}</span>
        <span className="muted">· 作成 {fmtDate(t.createdAt)}</span>
        {t.closedAt && <span className="muted">· {t.status === 'done' ? '完了' : '見送り'} {fmtDate(t.closedAt)}</span>}
      </div>
      <h2 className="detail-title">{t.title}</h2>
      <div className="seg status-seg" role="group" aria-label="状態">
        {(['todo', 'doing', 'done', 'dropped'] as TaskStatus[]).map((s) => (
          <button key={s} className={t.status === s ? 'on' : ''} onClick={() => onStatus(s)}>{TASK_STATUS_LABEL[s]}</button>
        ))}
      </div>
      <div className="task-facts">
        {t.tagIds.length > 0 && <div className="tag-pick">{t.tagIds.map((id) => p.tags[id] && <TagChip key={id} tag={p.tags[id]} small />)}</div>}
        {t.due && <div>期限: <DueLabel date={t.due} done={!isOpenTask(t)} /></div>}
        {ms && <div>マイルストーン: 🏁 {ms.title}（{ms.date.replace(/-/g, '/')}）</div>}
        {branch && (
          <div>ブランチ: <span className="dot" style={{ background: colors.get(branch.id) }} />{' '}
            <button className="link-btn" onClick={() => onCheckout(branch.id)}>{branch.name}</button> <StatusBadge status={branch.status} />
          </div>
        )}
        {source && <div>きっかけの記録: <button className="link-btn" onClick={() => onSelectCommit(source.id)}>{source.title}</button></div>}
      </div>
      <div className="detail-actions">
        <button className="btn" onClick={onEdit}>編集</button>
        <button className="btn primary" onClick={onRecord} title="このタスクに取り組んだ内容を、現在のブランチに記録する">＋ このタスクについて記録</button>
        {!branch && <button className="btn accent" onClick={onBranch} title="このタスクを検証するための新しい筋を始める">⑂ ブランチを始める</button>}
        <button className="btn danger-ghost" onClick={onDelete}>削除</button>
      </div>
      {t.body.trim() ? <Markdown text={t.body} /> : <p className="muted">説明なし</p>}
      <div className="detail-section">
        <h4>取り組んだ記録</h4>
        {records.length === 0 ? (
          <p className="muted small">まだありません。記録するときに「取り組んだタスク」でこのタスクを選ぶと、ここに並びます。</p>
        ) : (
          <ul className="rel">
            {records.map((c) => (
              <li key={c.id}>
                <button className="link-btn" onClick={() => onSelectCommit(c.id)}>{c.title}</button>{' '}
                <span className="muted small">（{p.branches[c.branchId]?.name}・{fmtDate(c.createdAt)}）</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- タスク編集 ----------

export function TaskEditor({ project: p, initial, heading, sub, onSubmit, onCancel }: {
  project: Project;
  initial?: Partial<Task>;
  heading: string;
  sub?: React.ReactNode;
  onSubmit: (input: TaskInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [tagIds, setTagIds] = useState<ID[]>(initial?.tagIds ?? []);
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? 'todo');
  const [due, setDue] = useState(initial?.due ?? '');
  const [milestoneId, setMilestoneId] = useState<ID>(initial?.milestoneId ?? '');
  const submit = () => {
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), body, tagIds, status, due: due || null, milestoneId: milestoneId || null });
  };
  return (
    <form className="editor" onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
      <h2>{heading}</h2>
      {sub && <div className="editor-sub">{sub}</div>}
      <label className="field">
        <span>タイトル（これからやること）</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: seed を増やして RQ2 の結果を再確認する" required autoFocus />
      </label>
      <div className="grid2">
        <label className="field"><span>状態</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {(['todo', 'doing', 'done', 'dropped'] as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="field"><span>期限（任意）</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="field span2"><span>マイルストーン（任意）</span>
          <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
            <option value="">なし</option>
            {sortedMilestones(p).map((m) => <option key={m.id} value={m.id}>{m.title}（{m.date.replace(/-/g, '/')}）</option>)}
          </select>
        </label>
      </div>
      <div className="field">
        <span>タグ</span>
        <div className="tag-pick">
          {p.tagOrder.map((id) => p.tags[id] && (
            <TagChip key={id} tag={p.tags[id]} active={tagIds.includes(id)}
              onClick={() => setTagIds(tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id])} />
          ))}
        </div>
      </div>
      <label className="field">
        <span>説明（Markdown、任意）</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder={'背景、完了の条件、参考になる記録 [[...]] など\n\n- [ ] 小さな手順を箇条書きにしても OK'} />
      </label>
      <div className="editor-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="btn primary" disabled={!title.trim()}>保存</button>
      </div>
    </form>
  );
}

// ---------- マイルストーン編集 ----------

export function MilestoneDialog({ initial, onSubmit, onDelete, onClose }: {
  initial?: Milestone;
  onSubmit: (m: Omit<Milestone, 'id'>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  return (
    <Modal title={initial ? 'マイルストーンを編集' : 'マイルストーンを追加'} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (title.trim() && date) onSubmit({ title: title.trim(), date, description: description.trim() }); }}>
        <label className="field"><span>名前</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: ACL 2027 投稿締切、中間発表" required /></label>
        <label className="field"><span>日付</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="field"><span>メモ（任意）</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></label>
        <div className="editor-actions">
          {onDelete && <button type="button" className="btn danger-ghost" onClick={onDelete}>削除</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn primary" disabled={!title.trim() || !date}>保存</button>
        </div>
      </form>
    </Modal>
  );
}
