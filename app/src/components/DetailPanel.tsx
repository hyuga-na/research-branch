import { useMemo, useRef, useState } from 'react';
import type { Commit, ID, Project, Reference, ResultItem } from '../types';
import { childrenMap, isOpenTask, lineage, type CommitInput } from '../store';
import { attachmentMarkdown, backlinks, uploadAttachment } from '../wiki';
import { emptyRef, fullCite, makeKey, parseBibtex, toBibtex } from '../bib';
import { branchColorMap } from '../graph';
import { fmtDate, Markdown, StatusBadge, TagChip, TaskStatusBadge } from './ui';

// ---------- 記録エディタ ----------

export function CommitEditor({
  project: p, initial, heading, sub, submitLabel, defaultTaskIds, onSubmit, onCancel,
}: {
  project: Project;
  initial?: Commit;
  heading: string;
  sub?: React.ReactNode;
  submitLabel: string;
  /** タスクから記録を始めたときに最初から紐づけるタスク */
  defaultTaskIds?: ID[];
  onSubmit: (input: CommitInput, closeTasks: boolean) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [tagIds, setTagIds] = useState<ID[]>(initial?.tagIds ?? []);
  const [links, setLinks] = useState((initial?.links ?? []).join('\n'));
  const [taskIds, setTaskIds] = useState<ID[]>(initial?.taskIds ?? defaultTaskIds ?? []);
  const [closeTasks, setCloseTasks] = useState(false);
  const [ref, setRef] = useState<Reference>(initial?.ref ?? emptyRef());
  const [bibText, setBibText] = useState('');
  const [bibErr, setBibErr] = useState('');
  const [results, setResults] = useState<ResultItem[]>(initial?.results?.length ? initial.results : []);
  const priorTag = p.tagOrder.find((t) => p.tags[t]?.name === '先行研究');
  const resultTag = p.tagOrder.find((t) => p.tags[t]?.name === '実験結果');
  const [refOpen, setRefOpen] = useState(!!initial?.ref);
  const [resOpen, setResOpen] = useState(!!initial?.results?.length);
  // 他の記録で使われている項目名（入力候補）
  const resultKeys = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of Object.values(p.commits)) for (const r of c.results) if (r.key) count.set(r.key, (count.get(r.key) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [p.commits]);
  const taskChoices = Object.values(p.tasks)
    .filter((t) => isOpenTask(t) || taskIds.includes(t.id))
    .sort((a, b) => a.number - b.number);
  const setRefField = (k: keyof Reference, v: string) => setRef((r) => ({ ...r, [k]: v }));
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadErr, setUploadErr] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 最後のカーソル位置（未操作なら末尾に挿入） */
  const selRef = useRef<[number, number] | null>(null);
  const rememberSel = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    selRef.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd];
  };

  /** カーソル位置にテキストを挿入 */
  const insertText = (text: string) => {
    const ta = taRef.current;
    const sel = selRef.current;
    setBody((prev) => {
      const start = sel ? Math.min(sel[0], prev.length) : prev.length;
      const end = sel ? Math.min(sel[1], prev.length) : prev.length;
      const before = prev.slice(0, start);
      const sep = before && !before.endsWith('\n') && text.startsWith('!') ? '\n' : '';
      const next = before + sep + text + prev.slice(end);
      const pos = start + sep.length + text.length;
      selRef.current = [pos, pos];
      requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(pos, pos); } });
      return next;
    });
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setPreview(false);
    setUploadErr('');
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const { path, name } = await uploadAttachment(p.id, f);
        insertText(attachmentMarkdown(path, name) + '\n');
      } catch (e) {
        setUploadErr(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const pickCandidates = Object.values(p.commits)
    .filter((c) => c.id !== initial?.id && c.title.toLowerCase().includes(pickQuery.trim().toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  const submit = () => {
    if (!title.trim()) return;
    const hasRefData = !!(ref.title.trim() || ref.authors.trim());
    onSubmit({
      title: title.trim(),
      body,
      tagIds,
      links: links.split('\n').map((s) => s.trim()).filter(Boolean),
      taskIds,
      ref: hasRefData ? { ...ref, key: ref.key.trim() || makeKey(ref) } : null,
      results: results.map((r) => ({ key: r.key.trim(), value: r.value.trim() })).filter((r) => r.key && r.value),
    }, closeTasks);
  };

  const importBib = () => {
    const r = parseBibtex(bibText);
    if (!r) { setBibErr('BibTeX を読み取れませんでした（@article{key, ... } の形で貼り付けてください）'); return; }
    setBibErr('');
    setRef(r);
    setBibText('');
    if (!title.trim() && r.title) setTitle(`サーベイ: ${r.title}`);
    if (r.doi && !links.includes(r.doi)) setLinks((l) => (l ? l + '\n' : '') + `https://doi.org/${r.doi}`);
    if (priorTag && !tagIds.includes(priorTag)) setTagIds((t) => [...t, priorTag]);
  };

  return (
    <form
      className="editor"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
    >
      <h2>{heading}</h2>
      {sub && <div className="editor-sub">{sub}</div>}
      <label className="field">
        <span>タイトル（このステップで何をしたか・何がわかったか）</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: ○○ (2023) を読み、手法Aの限界を整理" required autoFocus />
      </label>
      <div className="field">
        <span>タグ</span>
        <div className="tag-pick">
          {p.tagOrder.map((id) => p.tags[id] && (
            <TagChip
              key={id}
              tag={p.tags[id]}
              active={tagIds.includes(id)}
              onClick={() => {
                const on = !tagIds.includes(id);
                setTagIds(on ? [...tagIds, id] : tagIds.filter((t) => t !== id));
                // タグに合わせて関連する入力欄を開く
                if (on && id === priorTag) setRefOpen(true);
                if (on && id === resultTag) setResOpen(true);
              }}
            />
          ))}
        </div>
      </div>
      {taskChoices.length > 0 && (
        <div className="field">
          <span>取り組んだタスク</span>
          <div className="tag-pick">
            {taskChoices.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`task-chip${taskIds.includes(t.id) ? ' on' : ''}`}
                onClick={() => setTaskIds(taskIds.includes(t.id) ? taskIds.filter((x) => x !== t.id) : [...taskIds, t.id])}
                title={t.title}
              >
                #{t.number} {t.title.length > 22 ? t.title.slice(0, 22) + '…' : t.title}
              </button>
            ))}
          </div>
          {taskIds.some((id) => p.tasks[id] && isOpenTask(p.tasks[id])) && (
            <label className="check">
              <input type="checkbox" checked={closeTasks} onChange={(e) => setCloseTasks(e.target.checked)} />
              保存したら、選んだタスクを「完了」にする
            </label>
          )}
        </div>
      )}
      <div className="field">
        <span className="field-row">
          本文（Markdown）
          <span className="seg">
            <button type="button" className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>編集</button>
            <button type="button" className={preview ? 'on' : ''} onClick={() => setPreview(true)}>プレビュー</button>
          </span>
        </span>
        <div className="md-toolbar">
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()} title="画像・PDF・データなどを添付">📎 画像・ファイルを添付</button>
          <span className="picker-wrap">
            <button type="button" className="btn sm" onClick={() => { setPicker(!picker); setPickQuery(''); }} title="他の記録へのリンク [[タイトル]] を挿入">🔗 記録へのリンク</button>
            {picker && (
              <div className="picker" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPicker(false); } }}>
                <input autoFocus value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="記録を検索" aria-label="リンク先の記録を検索" />
                <ul>
                  {pickCandidates.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => { insertText(`[[${c.title}]]`); setPicker(false); }}>{c.title}</button>
                    </li>
                  ))}
                  {pickCandidates.length === 0 && <li className="muted small">該当なし</li>}
                </ul>
              </div>
            )}
          </span>
          {uploading > 0 && <span className="muted small">アップロード中…（{uploading}）</span>}
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { handleFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
          />
        </div>
        {preview ? (
          <div className="preview-box"><Markdown text={body} /></div>
        ) : (
          <textarea
            ref={taRef}
            className={dragOver ? 'drag-over' : ''}
            value={body}
            onChange={(e) => { setBody(e.target.value); rememberSel(e); }}
            onSelect={rememberSel}
            onKeyUp={rememberSel}
            onClick={rememberSel}
            rows={12}
            placeholder={'背景・目的、やったこと、結果、次にやること など\n\n画像はここに貼り付け（Ctrl+V）やドラッグ＆ドロップでも追加できます。\n他の記録へは [[記録のタイトル]] でリンクできます。'}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) { e.preventDefault(); handleFiles(files); }
            }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              setDragOver(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length) { e.preventDefault(); handleFiles(files); }
            }}
          />
        )}
        {uploadErr && <p className="error small">{uploadErr}</p>}
      </div>
      <label className="field">
        <span>リンク（論文URL・DOI・コードのパス・データの場所など、1行に1つ）</span>
        <textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={3} placeholder="https://doi.org/...&#10;experiments/exp01/train.py" />
      </label>

      <details className="fold" open={refOpen} onToggle={(e) => setRefOpen((e.target as HTMLDetailsElement).open)}>
        <summary>📚 文献情報（先行研究の記録に付けると BibTeX を書き出せます）</summary>
        <div className="fold-body">
          <div className="field">
            <span>BibTeX を貼り付けて読み込む（Google Scholar などからコピー）</span>
            <textarea value={bibText} onChange={(e) => setBibText(e.target.value)} rows={3} placeholder={'@inproceedings{perez2018film,\n  title={FiLM: ...}, author={Perez, Ethan and ...}, year={2018}\n}'} />
            <div className="row-gap">
              <button type="button" className="btn sm" onClick={importBib} disabled={!bibText.trim()}>読み込む</button>
              {bibErr && <span className="error small">{bibErr}</span>}
            </div>
          </div>
          <div className="grid2">
            <label className="field span2"><span>著者（「A and B and C」の形）</span><input value={ref.authors} onChange={(e) => setRefField('authors', e.target.value)} placeholder="Perez, Ethan and Strub, Florian" /></label>
            <label className="field span2"><span>タイトル</span><input value={ref.title} onChange={(e) => setRefField('title', e.target.value)} /></label>
            <label className="field"><span>年</span><input value={ref.year} onChange={(e) => setRefField('year', e.target.value)} placeholder="2018" /></label>
            <label className="field"><span>種類</span>
              <select value={ref.type} onChange={(e) => setRefField('type', e.target.value)}>
                <option value="inproceedings">会議論文</option>
                <option value="article">論文誌</option>
                <option value="misc">プレプリント・その他</option>
                <option value="book">書籍</option>
              </select>
            </label>
            <label className="field span2"><span>会議名・論文誌名</span><input value={ref.venue} onChange={(e) => setRefField('venue', e.target.value)} placeholder="Proceedings of AAAI" /></label>
            <label className="field"><span>DOI</span><input value={ref.doi} onChange={(e) => setRefField('doi', e.target.value)} /></label>
            <label className="field"><span>BibTeX キー</span><input value={ref.key} onChange={(e) => setRefField('key', e.target.value)} placeholder={makeKey(ref) || '自動で作成'} /></label>
            <label className="field span2"><span>URL</span><input value={ref.url} onChange={(e) => setRefField('url', e.target.value)} /></label>
          </div>
        </div>
      </details>

      <details className="fold" open={resOpen} onToggle={(e) => setResOpen((e.target as HTMLDetailsElement).open)}>
        <summary>📊 条件・結果の値（一覧の「比較表」で並べて比べられます）</summary>
        <div className="fold-body">
          <datalist id="result-keys">{resultKeys.map((k) => <option key={k} value={k} />)}</datalist>
          {results.map((r, i) => (
            <div key={i} className="kv-row">
              <input list="result-keys" value={r.key} placeholder="項目（例: 手法, seed, accuracy）" aria-label="項目名"
                onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <input value={r.value} placeholder="値" aria-label="値"
                onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button type="button" className="icon-btn sm" aria-label="この行を削除" onClick={() => setResults(results.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <div className="row-gap">
            <button type="button" className="btn sm" onClick={() => setResults([...results, { key: '', value: '' }])}>＋ 行を追加</button>
            {results.length === 0 && resultKeys.length > 0 && (
              <button type="button" className="btn sm ghost" onClick={() => setResults(resultKeys.slice(0, 6).map((k) => ({ key: k, value: '' })))}>
                よく使う項目で始める
              </button>
            )}
          </div>
        </div>
      </details>

      <div className="editor-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="btn primary" disabled={!title.trim()}>{submitLabel}</button>
      </div>
      <p className="hint">Ctrl + Enter でも保存できます。</p>
    </form>
  );
}

// ---------- コミット詳細 ----------

export function CommitDetail({
  project: p, commit: c, onEdit, onBranch, onDelete, onSelect, onCheckout, onNewTask, onOpenTask, onUnmerge, onMoveUp, onMoveDown,
}: {
  project: Project;
  commit: Commit;
  onEdit: () => void;
  onBranch: () => void;
  onDelete: () => void;
  onSelect: (id: ID) => void;
  onCheckout: (id: ID) => void;
  onNewTask: () => void;
  onOpenTask: (id: ID) => void;
  onUnmerge: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [bibCopied, setBibCopied] = useState(false);
  const mergeFrom = c.mergeParentId ? p.commits[c.mergeParentId] : null;
  const linkedTasks = c.taskIds.map((id) => p.tasks[id]).filter(Boolean);
  const spawnedTasks = Object.values(p.tasks).filter((t) => t.sourceCommitId === c.id && !c.taskIds.includes(t.id));
  const taskRow = (t: (typeof linkedTasks)[number], note?: string) => (
    <li key={t.id}>
      <TaskStatusBadge status={t.status} />{' '}
      <button className="link-btn" onClick={() => onOpenTask(t.id)}>#{t.number} {t.title}</button>
      {note && <span className="muted small"> {note}</span>}
    </li>
  );
  const colors = branchColorMap(p);
  const branch = p.branches[c.branchId];
  const kids = childrenMap(p).get(c.id) ?? [];
  const depth = lineage(p, c.id).length;
  const parent = c.parentId ? p.commits[c.parentId] : null;
  const forks = Object.values(p.branches).filter((b) => b.baseId === c.id);
  const isLeaf = kids.length === 0;
  const isCurrentHead = p.branches[p.currentBranchId].headId === c.id;
  const refs = backlinks(p, c);

  return (
    <div className="detail">
      <div className="detail-meta">
        <span className="dot" style={{ background: colors.get(c.branchId) }} />
        <span>{branch?.name ?? '?'}</span>
        <span className="muted">· ステップ {depth}</span>
        <span className="muted">· {fmtDate(c.createdAt, true)}</span>
      </div>
      <h2 className="detail-title">{c.title}</h2>
      {c.tagIds.length > 0 && (
        <div className="tag-pick">{c.tagIds.map((t) => p.tags[t] && <TagChip key={t} tag={p.tags[t]} />)}</div>
      )}
      <div className="detail-actions">
        <button className="btn" onClick={onEdit}>編集</button>
        <button className="btn accent" onClick={onBranch} title="このコミットまで戻り、新しい筋（ブランチ）を始める">⑂ ここから分岐</button>
        <button className="btn danger-ghost" onClick={onDelete} title={isLeaf ? "この記録を削除" : "この記録を削除し、前後の記録をつなぎ直す"}>削除</button>
      </div>
      <div className="move-row">
        <span className="muted small">順番:</span>
        <button className="btn sm" onClick={onMoveUp} disabled={!onMoveUp} title="同じブランチ内で、ひとつ前の記録と入れ替える">↑ 前へ</button>
        <button className="btn sm" onClick={onMoveDown} disabled={!onMoveDown} title="同じブランチ内で、ひとつ後の記録と入れ替える">↓ 後ろへ</button>
        <span className="muted small">グラフ上でドラッグしても移動できます</span>
      </div>
      {!isCurrentHead && (
        <p className="hint">
          ここは現在のブランチ「{p.branches[p.currentBranchId].name}」の先端ではありません。
          ここから別の方向へ進めたい場合は「ここから分岐」を使います。
        </p>
      )}
      {mergeFrom && (
        <p className="merge-note">
          ⇄ ブランチ「{p.branches[mergeFrom.branchId]?.name ?? '?'}」の成果を統合した記録です（統合元の先端:{' '}
          <button className="link-btn" onClick={() => onSelect(mergeFrom.id)}>{mergeFrom.title}</button>）
          <br />
          <button className="btn sm unmerge-btn" onClick={onUnmerge}>↩ この統合を取り消す</button>
        </p>
      )}
      {c.body.trim() ? <Markdown text={c.body} /> : !mergeFrom && <p className="muted">本文なし</p>}
      {c.ref && (c.ref.title || c.ref.authors) && (
        <div className="detail-section">
          <h4>📚 文献情報</h4>
          <p className="cite"><Markdown text={fullCite(c.ref)} /></p>
          <div className="row-gap">
            <button className="btn sm" onClick={() => navigator.clipboard.writeText(toBibtex(c.ref!)).then(() => { setBibCopied(true); setTimeout(() => setBibCopied(false), 1500); }).catch(() => {})}>
              {bibCopied ? 'コピーしました' : 'BibTeX をコピー'}
            </button>
            <code className="small">{c.ref.key}</code>
          </div>
        </div>
      )}
      {c.results.length > 0 && (
        <div className="detail-section">
          <h4>📊 条件・結果の値</h4>
          <table className="kv-table"><tbody>
            {c.results.map((r, i) => <tr key={i}><th>{r.key}</th><td>{r.value}</td></tr>)}
          </tbody></table>
        </div>
      )}
      <div className="detail-section">
        <div className="section-head">
          <h4>タスク</h4>
          <button className="btn sm" onClick={onNewTask}>＋ この記録からタスクを作る</button>
        </div>
        {linkedTasks.length === 0 && spawnedTasks.length === 0 ? (
          <p className="muted small">「次にやること」が出てきたら、ここからタスクにしておくと忘れません。</p>
        ) : (
          <ul className="rel plain">
            {linkedTasks.map((t) => taskRow(t, '（この記録で取り組んだ）'))}
            {spawnedTasks.map((t) => taskRow(t, '（この記録から作成）'))}
          </ul>
        )}
      </div>
      {c.links.length > 0 && (
        <div className="detail-section">
          <h4>リンク</h4>
          <ul className="links">
            {c.links.map((l, i) => (
              <li key={i}>{/^https?:\/\//.test(l) ? <a href={l} target="_blank" rel="noreferrer">{l}</a> : <code>{l}</code>}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="detail-section">
        <h4>つながり</h4>
        <ul className="rel">
          {parent && <li><span className="muted">前:</span> <button className="link-btn" onClick={() => onSelect(parent.id)}>{parent.title}</button></li>}
          {kids.map((k) => (
            <li key={k.id}>
              <span className="muted">次{kids.length > 1 ? `（${p.branches[k.branchId]?.name}）` : ''}:</span>{' '}
              <button className="link-btn" onClick={() => onSelect(k.id)}>{k.title}</button>
            </li>
          ))}
          {forks.map((b) => (
            <li key={b.id}>
              <span className="muted">分岐:</span>{' '}
              <button className="link-btn" onClick={() => onCheckout(b.id)}>{b.name}</button> <StatusBadge status={b.status} />
              {b.note && <div className="muted small">理由: {b.note}</div>}
            </li>
          ))}
        </ul>
      </div>
      <div className="detail-section">
        <h4>この記録を参照している記録（バックリンク）</h4>
        {refs.length === 0 ? (
          <p className="muted small">まだありません。他の記録の本文に [[{c.title}]] と書くとここに表示されます。</p>
        ) : (
          <ul className="rel">
            {refs.map((r) => (
              <li key={r.id}>
                <button className="link-btn" onClick={() => onSelect(r.id)}>{r.title}</button>{' '}
                <span className="muted small">（{p.branches[r.branchId]?.name}）</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
