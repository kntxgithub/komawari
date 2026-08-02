/* ============================================================
   コマ割りカタログ — 幾何ユーティリティ
   ------------------------------------------------------------
   カタログ表示・エディタ・パターンの読み込みで共有する。
   座標はすべてページ正規化座標（0..1、左上が原点）。
   ============================================================ */

/** ページの描画サイズ（B5 系の漫画ページに近い比率） */
const PAGE_W = 100;
const PAGE_H = 142;
const PAGE_ASPECT = PAGE_H / PAGE_W;

const round6 = v => Math.round(v * 1e6) / 1e6;

/** ポリゴンの面積（符号なし） */
function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return Math.abs(a) / 2;
}

/** ポリゴンの外接矩形 */
function bboxOf(poly) {
  const xs = poly.map(p => p[0]);
  const ys = poly.map(p => p[1]);
  return {
    x0: Math.min(...xs), y0: Math.min(...ys),
    x1: Math.max(...xs), y1: Math.max(...ys),
  };
}

/* 正規化座標 ⇄ ページ座標。線の操作は見た目どおりに動かしたいので
   ページ比を反映した座標で計算する。 */
const toPage = ([x, y]) => [x * PAGE_W, y * PAGE_H];
const fromPage = ([x, y]) => [x / PAGE_W, y / PAGE_H];

/** 点と線分の距離 */
function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** 点がポリゴン内部にあるか（レイキャスト） */
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 連続する重複頂点と閉じ重複を落とす */
function dedupePoly(poly) {
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) out.push(p);
  }
  if (out.length > 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) out.pop();
  }
  return out.map(p => [round6(p[0]), round6(p[1])]);
}

/** 直線 (p0, 法線 n) の片側だけを残す（Sutherland–Hodgman） */
function clipHalf(poly, p0, n, keepPositive) {
  const sgn = keepPositive ? 1 : -1;
  const d = poly.map(v => sgn * ((v[0] - p0[0]) * n[0] + (v[1] - p0[1]) * n[1]));
  const out = [];
  const E = 1e-9;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    if (d[i] >= -E) out.push(poly[i]);
    if ((d[i] > E && d[j] < -E) || (d[i] < -E && d[j] > E)) {
      const t = d[i] / (d[i] - d[j]);
      out.push([
        poly[i][0] + t * (poly[j][0] - poly[i][0]),
        poly[i][1] + t * (poly[j][1] - poly[i][1]),
      ]);
    }
  }
  return out;
}

/**
 * 点 p0 を通り方向 dir の直線でポリゴンを2つに割る。
 * どちらかが minArea 未満、または割れない場合は null。
 */
function splitPolygon(poly, p0, dir, minArea = 0.004) {
  const len = Math.hypot(dir[0], dir[1]);
  if (len < 1e-6) return null;
  const n = [-dir[1] / len, dir[0] / len];
  const a = dedupePoly(clipHalf(poly, p0, n, true));
  const b = dedupePoly(clipHalf(poly, p0, n, false));
  if (a.length < 3 || b.length < 3) return null;
  if (polyArea(a) < minArea || polyArea(b) < minArea) return null;
  return [a, b];
}

/**
 * 外接矩形の集合を「段」にまとめる。
 * 同じ段に入る条件は次の2つ:
 *   ・y 方向に半分以上重なる
 *   ・既にその段にあるコマと x 方向で半分以上は重ならない
 * 2つ目がないと、斜め分割や重ねゴマで上下に並んだコマまで
 * 「横並びの1段」と誤判定されてしまう。
 *
 * 段は上から順、段内は右から左（日本の漫画の読み順）に並べる。
 * 返り値: [{ y0, y1, items: [box, ...] }, ...]
 */
function tiersFromBoxes(boxes) {
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0);
  const tiers = [];

  for (const c of sorted) {
    const ch = c.y1 - c.y0;
    let placed = false;

    for (const t of tiers) {
      const ov = Math.min(t.y1, c.y1) - Math.max(t.y0, c.y0);
      if (ov <= 0.5 * Math.min(ch, t.y1 - t.y0)) continue;

      const overlapsX = t.items.some(b => {
        const xo = Math.min(b.x1, c.x1) - Math.max(b.x0, c.x0);
        return xo > 0.5 * Math.min(b.x1 - b.x0, c.x1 - c.x0);
      });
      if (overlapsX) continue;

      t.y0 = Math.min(t.y0, c.y0);
      t.y1 = Math.max(t.y1, c.y1);
      t.items.push(c);
      placed = true;
      break;
    }

    if (!placed) tiers.push({ y0: c.y0, y1: c.y1, items: [c] });
  }

  tiers.sort((a, b) => a.y0 - b.y0);
  // 右から左。右端がほぼ同じなら上から下（斜めに重なったコマ用）
  for (const t of tiers) {
    t.items.sort((a, b) => Math.abs(b.x1 - a.x1) > 0.08 ? b.x1 - a.x1 : a.y0 - b.y0);
  }
  return tiers;
}

/** 段構成シグネチャ（例: "1-2-1"） */
function signatureFromBoxes(boxes) {
  return tiersFromBoxes(boxes).map(t => t.items.length).join('-');
}

/**
 * 最大コマが「大ゴマ」と言えるか。
 * ページ全体に対する割合ではなく「残りのコマの平均の 1.5 倍超」で判定する。
 * コマ数が増えても基準がぶれず、2コマの 2:1 分割も拾えるため。
 */
function hasLargeArea(areas) {
  const n = areas.length;
  if (n < 2) return false;
  const total = areas.reduce((s, a) => s + a, 0);
  const max = Math.max(...areas);
  const restAvg = (total - max) / (n - 1);
  return restAvg > 0 && max > 1.5 * restAvg;
}

/** ポリゴンが軸平行でない辺を持つか */
function isDiagonalPoly(poly) {
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const dx = Math.abs(poly[j][0] - poly[i][0]);
    const dy = Math.abs(poly[j][1] - poly[i][1]);
    if (dx > 0.004 && dy > 0.004) return true;
  }
  return false;
}

/** 値がほぼ揃っているか */
function nearlyEqual(values, tol = 0.09) {
  if (values.length < 2) return true;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max > 0 && (max - min) / max <= tol;
}

/** 段構成が均等な格子か（段数・段内コマ数・高さ・幅がすべて揃う） */
function isGridTiers(tiers) {
  if (tiers.length < 2) return false;
  const k = tiers[0].items.length;
  if (!tiers.every(t => t.items.length === k)) return false;
  // 2段だけの横割りは「格子」とは呼ばない
  if (k === 1 && tiers.length < 3) return false;
  if (!nearlyEqual(tiers.map(t => t.y1 - t.y0))) return false;
  return tiers.every(t => nearlyEqual(t.items.map(b => b.x1 - b.x0)));
}

/** 縦長のコマが2つ以上横に並ぶ段があるか（ページ比を考慮した実寸で判定） */
function hasVerticalTier(tiers) {
  return tiers.some(t => t.items.length >= 2 && t.items.every(b => {
    const w = b.x1 - b.x0;
    return w > 0 && (b.y1 - b.y0) * PAGE_ASPECT / w > 1.6;
  }));
}

/**
 * コマ群（ポリゴン配列）から性格タグを自動判定する。
 * data.js の TAGS のキーを返す。
 */
function autoTags(cells) {
  const tags = new Set();
  const n = cells.length;
  const boxes = cells.map(bboxOf);
  const areas = cells.map(polyArea);
  const tiers = tiersFromBoxes(boxes);
  const diagonal = cells.some(isDiagonalPoly);
  const total = areas.reduce((s, a) => s + a, 0);

  if (diagonal) { tags.add('diagonal'); tags.add('dynamic'); }
  else { tags.add('static'); }

  if (total > 1.02) { tags.add('overlap'); tags.add('dynamic'); tags.delete('static'); }
  if (hasLargeArea(areas)) tags.add('large');
  if (n >= 6) tags.add('dense');
  if (hasVerticalTier(tiers)) tags.add('vertical');
  if (!diagonal && total <= 1.02 && isGridTiers(tiers)) tags.add('grid');

  return [...tags];
}

/** 連続する3点が一直線に並んでいるとき、中間の点を落とす */
function removeCollinear(poly) {
  if (poly.length <= 3) return poly;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[(i + poly.length - 1) % poly.length];
    const c = poly[i];
    const n = poly[(i + 1) % poly.length];
    const cross = (c[0] - p[0]) * (n[1] - p[1]) - (c[1] - p[1]) * (n[0] - p[0]);
    if (Math.abs(cross) > 1e-9) out.push(c);
  }
  return out.length >= 3 ? out : poly;
}

const samePoint = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/**
 * 2つのコマが完全に共有する辺を探す。
 * 両端が一致する辺だけを対象にする。部分的にしか重ならない辺は、
 * 統合すると形が一意に決まらないため扱わない。
 * 返り値: { i, j, flipB } — A[i]→A[i+1] と B[j]→B[j+1] が同じ辺。
 *         flipB が true なら B を逆回りにしてから使う。
 */
function sharedEdge(A, B) {
  for (const flipB of [false, true]) {
    const b = flipB ? [...B].reverse() : B;
    for (let i = 0; i < A.length; i++) {
      const a0 = A[i], a1 = A[(i + 1) % A.length];
      for (let j = 0; j < b.length; j++) {
        const b0 = b[j], b1 = b[(j + 1) % b.length];
        // 隣り合うコマは共有辺を逆向きに辿る
        if (samePoint(a0, b1) && samePoint(a1, b0)) return { i, j, flipB };
      }
    }
  }
  return null;
}

/**
 * 共有辺で接する2つのコマを1つに統合する。
 * 共有辺を通らずに A の外周 → B の外周と辿ることで、境界だけが消える。
 */
function mergePolygons(A, B, sh) {
  const b = sh.flipB ? [...B].reverse() : B;
  const out = [];
  for (let k = 1; k <= A.length; k++) out.push(A[(sh.i + k) % A.length]);
  for (let k = 1; k <= b.length; k++) out.push(b[(sh.j + k) % b.length]);
  return removeCollinear(dedupePoly(out));
}

/**
 * ページを左右反転する（x → 1-x）。
 * 鏡像にすると頂点の周回方向が裏返るので、並びも戻しておく。
 */
function mirrorCellsX(cells) {
  return cells.map(c => c.map(([x, y]) => [round6(1 - x), y]).reverse());
}

/** ページを上下反転する（y → 1-y） */
function flipCellsY(cells) {
  return cells.map(c => c.map(([x, y]) => [x, round6(1 - y)]).reverse());
}

/**
 * 読み順（右上 → 左 → 下段）を、コマ番号の並びとして返す。
 * 返り値の k 番目の要素が「k+1 番目に読むコマ」の添字。
 *
 * コマ配列そのものは並べ替えない。配列の並びは重ね順（奥から手前）であり、
 * 読み順とは別の概念だから。両者を同じ配列で表すと、読み順を入れ替えた
 * ときに重ねゴマが土台の下に潜ってしまう。
 */
function readingOrderIndices(cells) {
  const boxes = cells.map((c, i) => Object.assign(bboxOf(c), { _i: i }));
  const order = [];
  for (const t of tiersFromBoxes(boxes)) {
    for (const b of t.items) order.push(b._i);
  }
  return order;
}

/**
 * コマごとの読み順ラベル（1始まり）を返す。
 * readIndex が無い場合は「配列の並び＝読み順」とみなす。
 */
function readingLabels(cells, readIndex) {
  const n = cells.length;
  const order = isValidReadIndex(readIndex, n) ? readIndex : cells.map((_, i) => i);
  const labels = new Array(n);
  order.forEach((cellIndex, k) => { labels[cellIndex] = k + 1; });
  return labels;
}

/** readIndex が 0..n-1 の並べ替えとして妥当か */
function isValidReadIndex(readIndex, n) {
  if (!Array.isArray(readIndex) || readIndex.length !== n) return false;
  const seen = new Set(readIndex);
  return seen.size === n && readIndex.every(i => Number.isInteger(i) && i >= 0 && i < n);
}
