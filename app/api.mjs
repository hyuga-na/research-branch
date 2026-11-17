// ローカル保存用の最小 API。dev(Vite) と本番(server.mjs) の両方で使う。
//   GET/PUT /api/db              … 全データ (data/db.json)
//   POST    /api/attachments     … 画像・ファイルの保存 (data/attachments/<project>/...)
//   GET     /attachments/...     … 保存したファイルの配信
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const ATTACH_DIR = path.join(DATA_DIR, 'attachments');
const MAX_UPLOAD = 200 * 1024 * 1024;

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json',
  '.py': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

let lastBackup = 0;

const sendJson = (res, status, obj) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
};

/** ファイル名を安全な形にする（日本語は残す） */
const safeName = (s) =>
  (s || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(-120) || 'file';

export function apiHandler(req, res, next) {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;

  if (p === '/api/db') return handleDb(req, res);
  if (p === '/api/attachments' && req.method === 'POST') return handleUpload(req, res, url);
  if (p.startsWith('/attachments/') && (req.method === 'GET' || req.method === 'HEAD')) return serveAttachment(req, res, p);
  return next ? next() : false;
}

function handleDb(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE, 'utf8') : 'null');
    return true;
  }
  if (req.method === 'PUT') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        JSON.parse(body);
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        // 10分に1回、直前の状態をバックアップ
        if (fs.existsSync(DB_FILE) && Date.now() - lastBackup > 10 * 60 * 1000) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `db-${stamp}.json`));
          lastBackup = Date.now();
        }
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, body, 'utf8');
        fs.renameSync(tmp, DB_FILE);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: String(e) });
      }
    });
    return true;
  }
  res.statusCode = 405;
  res.end();
  return true;
}

function handleUpload(req, res, url) {
  const project = (url.searchParams.get('project') || 'common').replace(/[^a-zA-Z0-9_-]/g, '');
  const name = safeName(url.searchParams.get('name'));
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_UPLOAD) {
      aborted = true;
      sendJson(res, 413, { ok: false, error: 'ファイルが大きすぎます（上限 200MB）' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      const dir = path.join(ATTACH_DIR, project);
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      let file = `${stamp}-${name}`;
      for (let i = 1; fs.existsSync(path.join(dir, file)); i++) file = `${stamp}-${i}-${name}`;
      fs.writeFileSync(path.join(dir, file), Buffer.concat(chunks));
      sendJson(res, 200, { ok: true, path: `attachments/${project}/${encodeURIComponent(file)}`, name, size });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e) });
    }
  });
  return true;
}

function serveAttachment(req, res, pathname) {
  const rel = decodeURIComponent(pathname.slice('/attachments/'.length));
  const file = path.normalize(path.join(ATTACH_DIR, rel));
  if (!file.startsWith(ATTACH_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    res.end('not found');
    return true;
  }
  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  // SVG に含まれるスクリプトを実行させない
  if (ext === '.svg') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', fs.statSync(file).size);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}
