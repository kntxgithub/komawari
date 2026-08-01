/* ============================================================
   Manga109 アノテーション取り込み
   ------------------------------------------------------------
   Manga109 の annotations/*.xml をローカルで解析し、
   ・コマ数の出現分布
   ・構造シグネチャ（段構成）の出現分布
   ・大ゴマ率
   を集計する。画像は一切読み込まない（枠座標のみ）。

   XML 形式:
     <book title="..."><pages>
       <page index="0" width="1654" height="1170">
         <frame id=".." xmin=".." ymin=".." xmax=".." ymax=".."/>
       </page>
     </pages></book>

   注意: Manga109 の画像は見開き（横長）でスキャンされているものが多い。
         splitSpread=true のとき、横長ページは中央で左右に割って
         「単ページ」として集計する。
   ============================================================ */

const STORE_KEY = 'komawari.measured.v1';

/* ---------- パース ---------- */

function parseManga109Xml(xmlText, fileName, opts) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error(`XML として読めません: ${fileName}`);
  }
  const bookEl = doc.querySelector('book');
  if (!bookEl) throw new Error(`<book> がありません: ${fileName}`);

  const title = bookEl.getAttribute('title') || fileName.replace(/\.xml$/i, '');
  const pages = [];

  for (const pageEl of doc.querySelectorAll('page')) {
    const W = Number(pageEl.getAttribute('width'));
    const H = Number(pageEl.getAttribute('height'));
    if (!W || !H) continue;

    const frames = Array.from(pageEl.querySelectorAll('frame')).map(f => ({
      x0: Number(f.getAttribute('xmin')),
      y0: Number(f.getAttribute('ymin')),
      x1: Number(f.getAttribute('xmax')),
      y1: Number(f.getAttribute('ymax')),
    })).filter(f => f.x1 > f.x0 && f.y1 > f.y0);

    if (opts.splitSpread && W > H * 1.2) {
      const mid = W / 2;
      // 見開きの右ページ = 読み始め
      const right = frames.filter(f => (f.x0 + f.x1) / 2 >= mid);
      const left = frames.filter(f => (f.x0 + f.x1) / 2 < mid);
      pages.push(normalizePage(right, mid, 0, mid, H));
      pages.push(normalizePage(left, 0, 0, mid, H));
    } else {
      pages.push(normalizePage(frames, 0, 0, W, H));
    }
  }
  return { title, pages };
}

/** ページ矩形 (ox,oy,w,h) を基準に 0..1 へ正規化 */
function normalizePage(frames, ox, oy, w, h) {
  return frames.map(f => ({
    x0: (f.x0 - ox) / w,
    y0: (f.y0 - oy) / h,
    x1: (f.x1 - ox) / w,
    y1: (f.y1 - oy) / h,
  }));
}

/* ---------- 構造解析 ---------- */
/* 段構成の判定は geom.js と共有する（エディタ・カタログと同じ基準にするため） */

/** 最大コマが「大ゴマ」と言える大きさか */
function hasLargePanel(boxes) {
  return hasLargeArea(boxes.map(c => (c.x1 - c.x0) * (c.y1 - c.y0)));
}

/* ---------- 集計 ---------- */

function emptyStats() {
  return {
    books: [],
    totalPages: 0,
    countedPages: 0,      // 2〜7コマのページ数
    byCount: {},          // { 2: n, ... 7: n }
    bySig: {},            // { "1-2": { n, byCount:{...} } }
    largeByCount: {},     // { 2: 大ゴマありページ数, ... }
    outOfRange: 0,        // 0,1 コマ or 8コマ以上
    importedAt: null,
  };
}

function accumulate(stats, book) {
  stats.books.push({ title: book.title, pages: book.pages.length });
  for (const cells of book.pages) {
    stats.totalPages++;
    const n = cells.length;
    if (n < 2 || n > 7) { stats.outOfRange++; continue; }

    stats.countedPages++;
    stats.byCount[n] = (stats.byCount[n] || 0) + 1;

    const sig = signatureFromBoxes(cells);
    if (!stats.bySig[sig]) stats.bySig[sig] = { n: 0, byCount: {} };
    stats.bySig[sig].n++;
    stats.bySig[sig].byCount[n] = (stats.bySig[sig].byCount[n] || 0) + 1;

    if (hasLargePanel(cells)) {
      stats.largeByCount[n] = (stats.largeByCount[n] || 0) + 1;
    }
  }
  return stats;
}

/* ---------- 永続化 ---------- */

function saveStats(stats) {
  localStorage.setItem(STORE_KEY, JSON.stringify(stats));
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearStats() {
  localStorage.removeItem(STORE_KEY);
}

/* ---------- ファイル読み込み ---------- */

async function importFiles(fileList, opts, onProgress) {
  const xmls = Array.from(fileList).filter(f => /\.xml$/i.test(f.name));
  if (xmls.length === 0) throw new Error('.xml ファイルが見つかりません。');

  const stats = emptyStats();
  const errors = [];

  for (let i = 0; i < xmls.length; i++) {
    const file = xmls[i];
    onProgress?.(i + 1, xmls.length, file.name);
    try {
      const text = await file.text();
      accumulate(stats, parseManga109Xml(text, file.name, opts));
    } catch (e) {
      errors.push(`${file.name}: ${e.message}`);
    }
  }

  stats.importedAt = new Date().toISOString();
  return { stats, errors };
}
