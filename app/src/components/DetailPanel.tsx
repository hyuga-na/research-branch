import { useRef, useState } from 'react';
import type { Commit, ID, Project } from '../types';
import { childrenMap, lineage, type CommitInput } from '../store';
import { attachmentMarkdown, backlinks, uploadAttachment } from '../wiki';
import { branchColorMap } from '../graph';
import { fmtDate, Markdown, StatusBadge, TagChip } from './ui';

// ---------- 記録エディタ ----------

export function CommitEditor({
  project: p, initial, heading, sub, submitLabel, onSubmit, onCancel,
}: {
  project: Project;
  initial?: Commit;
  heading: string;
  sub?: React.ReactNode;
  submitLabel: string;
  onSubmit: (input: CommitInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [tagIds, setTagIds] = useState<ID[]>(initial?.tagIds ?? []);
  const [links, setLinks] = useState((initial?.links ?? []).join('\n'));
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
    onSubmit({
      title: title.trim(),
      body,
      tagIds,
      links: links.split('\n').map((s) => s.trim()).filter(Boolean),
    });
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
              onClick={() => setTagIds(tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id])}
            />
          ))}
        </div>
      </div>
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
  project: p, commit: c, onEdit, onBranch, onDelete, onSelect, onCheckout,
}: {
  project: Project;
  commit: Commit;
  onEdit: () => void;
  onBranch: () => void;
  onDelete: () => void;
  onSelect: (id: ID) => void;
  onCheckout: (id: ID) => void;
}) {
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
        {isLeaf && <button className="btn danger-ghost" onClick={onDelete}>削除</button>}
      </div>
      {!isCurrentHead && (
        <p className="hint">
          ここは現在のブランチ「{p.branches[p.currentBranchId].name}」の先端ではありません。
          ここから別の方向へ進めたい場合は「ここから分岐」を使います。
        </p>
      )}
      {c.body.trim() ? <Markdown text={c.body} /> : <p className="muted">本文なし</p>}
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
