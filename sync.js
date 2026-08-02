/* ============================================================
   パターンの持ち出しと持ち込み
   ------------------------------------------------------------
   localStorage はオリジン単位・端末単位なので、そのままでは
   別の端末に自作パターンを持っていけない。そこで2経路を用意する。

   1. 書き出し / 読み込み … JSON ファイル経由。手動だがどこでも使える
   2. patterns.json      … リポジトリに置くと起動時に自動で読み込まれる。
                            書き出したファイルを push すれば全端末に反映される

   patterns.json 由来のものは「共有」として扱い、画面からは消せない
   （消すにはリポジトリ側のファイルを直す）。
   ============================================================ */

const EXPORT_FORMAT = 'komawari-patterns';
const EXPORT_VERSION = 1;

/** patterns.json から読み込んだパターン */
let sharedLayouts = [];

/* ---------- 検証 ---------- */

function isValidCells(cells) {
  return Array.isArray(cells)
    && cells.length >= 2 && cells.length <= 7
    && cells.every(poly =>
      Array.isArray(poly) && poly.length >= 3
      && poly.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));
}

/**
 * 外から来た1件をパターンに整える。
 * シグネチャとタグは保存値を信用せず形状から引き直す
 * （判定ルールを変えたときに古い分類が残らないようにするため）。
 */
function normalizeIncoming(raw, { shared }) {
  if (!raw || typeof raw !== 'object' || !isValidCells(raw.cells)) return null;
  const cells = raw.cells.map(poly => poly.map(([x, y]) => [
    Math.min(1, Math.max(0, x)),
    Math.min(1, Math.max(0, y)),
  ]));
  return {
    id: String(raw.id || (shared ? 'shared-' : 'custom-') + Math.random().toString(36).slice(2)),
    panels: cells.length,
    name: String(raw.name || `${cells.length}コマ`).slice(0, 60),
    cells,
    sig: signatureFromBoxes(cells.map(bboxOf)),
    tags: autoTags(cells),
    note: String(raw.note || (shared ? '共有ファイルから読み込んだパターン。' : '')).slice(0, 200),
    est: null,
    custom: true,
    shared: !!shared,
    createdAt: String(raw.createdAt || ''),
  };
}

/* ---------- 書き出し ---------- */

function exportPatterns() {
  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    custom: customLayouts.map(l => ({
      id: l.id, name: l.name, cells: l.cells, note: l.note, createdAt: l.createdAt,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'patterns.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return payload.custom.length;
}

/* ---------- 読み込み ---------- */

/** 書き出したファイルを取り込む。同じ id のものは重複させない */
function importPatterns(json) {
  if (!json || json.format !== EXPORT_FORMAT) {
    throw new Error('komawari が書き出したファイルではないようです。');
  }
  const incoming = Array.isArray(json.custom) ? json.custom : [];
  const known = new Set(customLayouts.map(l => l.id));

  let added = 0, skipped = 0;
  for (const raw of incoming) {
    const layout = normalizeIncoming(raw, { shared: false });
    if (!layout) { skipped++; continue; }
    if (known.has(layout.id)) { skipped++; continue; }
    known.add(layout.id);
    customLayouts.push(layout);
    added++;
  }
  persistCustomLayouts();
  return { added, skipped };
}

/** 起動時に patterns.json を読む。無ければ黙って諦める */
async function loadSharedPatterns() {
  try {
    const res = await fetch('patterns.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const json = await res.json();
    if (json.format !== EXPORT_FORMAT) return;

    const localIds = new Set(customLayouts.map(l => l.id));
    sharedLayouts = (Array.isArray(json.custom) ? json.custom : [])
      .map(raw => normalizeIncoming(raw, { shared: true }))
      // 同じ id が手元にもあるなら、手元の編集を優先する
      .filter(l => l && !localIds.has(l.id));
  } catch {
    // file:// で開いた場合など。共有パターン無しで動かす
  }
}
