import { marked } from 'marked';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { BranchStatus, ID, Tag } from '../types';
import { isImagePath, isVideoPath, mapOutsideCode, WIKI_RE } from '../wiki';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_URL = /^(https?:|mailto:|attachments\/|#)/i;

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    // 生 HTML は表示しない（取り込んだデータ経由のスクリプト混入を防ぐ）
    html(html: string) {
      return escapeHtml(html);
    },
    link(href: string, title: string | null | undefined, text: string) {
      if (href.startsWith('#wiki:') || href.startsWith('#wiki-missing:')) {
        const missing = href.startsWith('#wiki-missing:');
        const target = decodeURIComponent(href.slice(href.indexOf(':') + 1));
        return `<a href="#" class="wikilink${missing ? ' missing' : ''}" data-wiki="${escapeHtml(target)}" title="${missing ? 'まだ存在しない記録' : escapeHtml(target)}">${text}</a>`;
      }
      if (!SAFE_URL.test(href)) return text;
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noreferrer">${text}</a>`;
    },
    image(href: string, title: string | null, text: string) {
      if (!SAFE_URL.test(href)) return escapeHtml(text);
      const src = escapeHtml(href);
      if (isVideoPath(href)) return `<video src="${src}" controls preload="metadata"></video>`;
      if (!isImagePath(href) && href.startsWith('attachments/')) return `<a href="${src}" target="_blank" rel="noreferrer">📎 ${text || href}</a>`;
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${src}" target="_blank" rel="noreferrer" class="img-link"><img src="${src}" alt="${escapeHtml(text)}"${t} loading="lazy"></a>`;
    },
  },
});

/** [[記録タイトル]] の解決とクリック時の移動 */
export const WikiContext = createContext<{ resolve: (title: string) => ID | null; open: (id: ID) => void }>({
  resolve: () => null,
  open: () => {},
});

export function Markdown({ text }: { text: string }) {
  const wiki = useContext(WikiContext);
  const html = useMemo(() => {
    const pre = mapOutsideCode(text || '', (s) =>
      s.replace(WIKI_RE, (_all, target: string, alias?: string) => {
        const label = (alias ?? target).replace(/[[\]]/g, '');
        const kind = wiki.resolve(target) ? 'wiki' : 'wiki-missing';
        const enc = encodeURIComponent(target.trim()).replace(/\(/g, '%28').replace(/\)/g, '%29');
        return `[${label}](#${kind}:${enc})`;
      }),
    );
    return marked.parse(pre, { async: false }) as string;
  }, [text, wiki]);
  return (
    <div
      className="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wikilink');
        if (!a) return;
        e.preventDefault();
        const id = wiki.resolve(a.dataset.wiki ?? '');
        if (id) wiki.open(id);
      }}
    />
  );
}

export function TagChip({ tag, active, onClick, small }: { tag: Tag; active?: boolean; onClick?: () => void; small?: boolean }) {
  const cls = `chip${active ? ' chip-active' : ''}${small ? ' chip-sm' : ''}${onClick ? ' chip-btn' : ''}`;
  const style = { '--tag': tag.color } as React.CSSProperties;
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick}>{tag.name}</button>
  ) : (
    <span className={cls} style={style}>{tag.name}</span>
  );
}

export const STATUS_LABEL: Record<BranchStatus, string> = {
  active: '進行中',
  adopted: '採用',
  abandoned: '棄却',
};

export function StatusBadge({ status }: { status: BranchStatus }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 重なったダイアログは一番上だけ閉じる
      const all = document.querySelectorAll('.modal-backdrop');
      if (all[all.length - 1] === ref.current?.parentElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} ref={ref} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- 確認ダイアログ（window.confirm は環境によって動かないため自前で用意） ----------

export interface ConfirmRequest {
  message: string;
  detail?: string;
  okLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export type AskConfirm = (message: string, opts?: { detail?: string; okLabel?: string; danger?: boolean }) => Promise<boolean>;

export function ConfirmDialog({ req, onDone }: { req: ConfirmRequest; onDone: () => void }) {
  const finish = (ok: boolean) => { req.resolve(ok); onDone(); };
  return (
    <Modal title="確認" onClose={() => finish(false)}>
      <p className="confirm-msg">{req.message}</p>
      {req.detail && <p className="muted small">{req.detail}</p>}
      <div className="editor-actions">
        <button type="button" className="btn ghost" onClick={() => finish(false)}>キャンセル</button>
        <button
          type="button"
          className={`btn ${req.danger ? 'danger' : 'primary'}`}
          onClick={() => finish(true)}
          autoFocus
        >
          {req.okLabel ?? 'OK'}
        </button>
      </div>
    </Modal>
  );
}

export function fmtDate(iso: string, withTime = false) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  const s = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  return withTime ? `${s} ${p(d.getHours())}:${p(d.getMinutes())}` : s;
}
