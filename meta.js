/* ============================================================
   パターンごとの付加情報
   ------------------------------------------------------------
   名前の上書き・お気に入り度・手動の並び順を、パターンの id をキーに
   まとめて持つ。シード・共有・自作のどれにも同じように付けられる。

   パターン本体（形）とは分けて保存する。data.js のシードは書き換えられず、
   patterns.json の共有パターンも読み込み直すと元に戻るため、
   上書き情報は別の場所に置く必要があるから。
   ============================================================ */

const META_KEY = 'komawari.meta.v1';
const MAX_RATING = 5;

function emptyMeta() {
  // orderTouched: 実際に並べ替えたか。表示のために自動で埋めただけの
  // 並びと区別するため。取り込み時にどちらを優先するかの判断に使う
  return { version: 1, names: {}, ratings: {}, order: [], orderTouched: false };
}

function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return emptyMeta();
    const m = JSON.parse(raw);
    return {
      version: 1,
      names: m.names && typeof m.names === 'object' ? m.names : {},
      ratings: m.ratings && typeof m.ratings === 'object' ? m.ratings : {},
      order: Array.isArray(m.order) ? m.order : [],
      orderTouched: !!m.orderTouched,
    };
  } catch {
    return emptyMeta();
  }
}

let meta = loadMeta();

function persistMeta() {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

/* ---------- 参照 ---------- */

/** 表示用の名前（上書きがあればそちら） */
function displayName(layout) {
  return meta.names[layout.id] || layout.name;
}

/** お気に入り度 0〜5 */
function ratingOf(layout) {
  const v = meta.ratings[layout.id];
  return Number.isInteger(v) && v >= 0 && v <= MAX_RATING ? v : 0;
}

/* ---------- 更新 ---------- */

function setLayoutName(layout, name) {
  const trimmed = String(name || '').trim().slice(0, 60);
  if (!trimmed || trimmed === layout.name) {
    delete meta.names[layout.id];   // 元の名前に戻したら上書きを消す
  } else {
    meta.names[layout.id] = trimmed;
  }
  // 自作パターンは本体にも反映する（書き出しファイルに載せるため）
  if (layout.custom && !layout.shared) {
    const own = customLayouts.find(l => l.id === layout.id);
    if (own && trimmed) own.name = trimmed;
    persistCustomLayouts();
  }
  persistMeta();
}

function setRating(layout, value) {
  const v = Math.max(0, Math.min(MAX_RATING, Number(value) || 0));
  if (v === 0) delete meta.ratings[layout.id];
  else meta.ratings[layout.id] = v;
  persistMeta();
}

/* ---------- 手動の並び順 ---------- */

/**
 * まだ並び順を持っていないパターンを、既定の並び（推定スコア順）で末尾に足す。
 * 手動並びに切り替えた時点の見え方を出発点にするため。
 */
function ensureOrder(layouts) {
  const known = new Set(meta.order);
  const missing = layouts.filter(l => !known.has(l.id))
    .sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0)
      || (b.est ?? 0) - (a.est ?? 0) || a.panels - b.panels);
  if (missing.length === 0) return;
  meta.order = meta.order.concat(missing.map(l => l.id));
  persistMeta();
}

function orderRank(layout) {
  const i = meta.order.indexOf(layout.id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/** movedId を targetId の位置へ差し込む */
function moveInOrder(movedId, targetId) {
  const from = meta.order.indexOf(movedId);
  if (from < 0) return false;
  meta.order.splice(from, 1);
  const to = meta.order.indexOf(targetId);
  meta.order.splice(to < 0 ? meta.order.length : to, 0, movedId);
  meta.orderTouched = true;
  persistMeta();
  return true;
}

function resetOrder() {
  meta.order = [];
  meta.orderTouched = false;
  persistMeta();
}

/* ---------- 構成による並べ替え ---------- */

/** 段数（構造シグネチャの段の個数） */
function tierCount(layout) {
  return layout.sig ? layout.sig.split('-').length : 0;
}

/** 列数（1段に並ぶコマ数の最大） */
function colCount(layout) {
  return layout.sig ? Math.max(...layout.sig.split('-').map(Number)) : 0;
}
