/* ============================================================
   コマ割りエディタ
   ------------------------------------------------------------
   ページの上でドラッグして分割線を引き、コマを割っていく。
   コマ数・段構成・性格タグは編集のたびに自動で再判定される。
   ============================================================ */

const CUSTOM_KEY = 'komawari.custom.v1';

/* ---------- 自作パターンの保存 ---------- */

function loadCustomLayouts() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

let customLayouts = loadCustomLayouts();

function persistCustomLayouts() {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(customLayouts));
}

function deleteCustomLayout(id) {
  customLayouts = customLayouts.filter(l => l.id !== id);
  persistCustomLayouts();
}

/* ---------- エディタ状態 ---------- */

const ed = {
  cells: [rect(0, 0, 1, 1)],   // 重ね順（奥 → 手前）。読み順ではない
  readIndex: [0],              // 読み順。k 番目の要素が k+1 番目に読むコマの添字
  history: [],
  mode: 'split',      // 'split' | 'overlay' | 'line' | 'order'
  snap: true,
  drag: null,         // { from:[x,y], to:[x,y] }
  manualOrder: false, // 読み順を手で入れ替えたら true。以後は自動整列しない
  pick: null,         // 入れ替え待ちのコマ番号
  hoverLine: null,    // 線モードでカーソル下にある線
  linePick: null,     // 選択中の線 { group, merge }
  overlayPick: null,  // 選択中の重ねゴマ
};

const clone = cells => cells.map(c => c.map(p => [p[0], p[1]]));

function pushHistory() {
  ed.history.push({
    cells: clone(ed.cells),
    readIndex: ed.readIndex.slice(),
    manualOrder: ed.manualOrder,
  });
  if (ed.history.length > 60) ed.history.shift();
}

/**
 * コマ列を差し替える。
 *
 * ed.cells の並びは「重ね順（奥から手前）」であり、読み順ではない。
 * 読み順は ed.readIndex が持つ。手動調整済みなら呼び出し側が対応する
 * readIndex を渡し、そうでなければ形状から引き直す。
 */
function setCells(cells, readIndex) {
  ed.cells = cells;
  ed.readIndex = (ed.manualOrder && isValidReadIndex(readIndex, cells.length))
    ? readIndex
    : readingOrderIndices(cells);
  refreshEditor();
}

/* ---------- 分割の計算 ---------- */

/** ドラッグから「どのコマを・どの直線で割るか」を決める */
function planSplit(drag, freeAngle) {
  const [ax, ay] = drag.from;
  const [bx, by] = drag.to;
  const dx = bx - ax, dy = by - ay;
  if (Math.hypot(dx, dy) < 0.02) return null;

  const mid = [(ax + bx) / 2, (ay + by) / 2];
  // スナップ時は中点を通る水平／垂直線、自由角度時はドラッグ線そのもの
  const dir = freeAngle
    ? [dx, dy]
    : (Math.abs(dx) >= Math.abs(dy) ? [1, 0] : [0, 1]);
  const through = freeAngle ? drag.from : mid;

  // 中点を含むコマを優先し、なければ始点を含むコマ（重ねゴマは上が優先）
  let target = -1;
  for (let i = ed.cells.length - 1; i >= 0; i--) {
    if (pointInPoly(mid, ed.cells[i])) { target = i; break; }
  }
  if (target < 0) {
    for (let i = ed.cells.length - 1; i >= 0; i--) {
      if (pointInPoly(drag.from, ed.cells[i])) { target = i; break; }
    }
  }
  if (target < 0) return null;

  const parts = splitPolygon(ed.cells[target], through, dir);
  return parts ? { target, parts } : null;
}

/* ---------- 境界線の移動 ---------- */

const LINE_GRAB = 4.5;   // 線をつかめる距離（ページ座標）
const LINE_EPS = 0.7;    // 同一直線・重なりとみなす許容量（ページ座標）

/** 全コマの辺をページ座標で列挙する */
function allEdges() {
  const out = [];
  ed.cells.forEach((cell, ci) => {
    for (let i = 0; i < cell.length; i++) {
      const j = (i + 1) % cell.length;
      out.push({ ci, i, j, a: toPage(cell[i]), b: toPage(cell[j]) });
    }
  });
  return out;
}

/** ページの外枠上の辺か（外枠は動かせない） */
function onPageBorder(e) {
  const near = (v, t) => Math.abs(v - t) < LINE_EPS;
  return (near(e.a[0], 0) && near(e.b[0], 0))
      || (near(e.a[0], PAGE_W) && near(e.b[0], PAGE_W))
      || (near(e.a[1], 0) && near(e.b[1], 0))
      || (near(e.a[1], PAGE_H) && near(e.b[1], PAGE_H));
}

/**
 * つかんだ辺と同じ直線上にあり、かつ区間が繋がっている辺をまとめる。
 * 「上1コマ＋下3コマ」の横線のように、1本の線が複数コマに接している場合でも
 * まとめて動かすため。区間が離れていれば別の線として扱う
 * （2段組で各段に別々の縦線がある場合など）。
 */
function buildLineGroup(seed) {
  const dx = seed.b[0] - seed.a[0], dy = seed.b[1] - seed.a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;

  const d = [dx / len, dy / len];
  const normal = [-d[1], d[0]];
  const p0 = seed.a;
  const proj = q => (q[0] - p0[0]) * d[0] + (q[1] - p0[1]) * d[1];
  const dist = q => Math.abs((q[0] - p0[0]) * normal[0] + (q[1] - p0[1]) * normal[1]);

  const items = allEdges()
    .filter(e => dist(e.a) < LINE_EPS && dist(e.b) < LINE_EPS)
    .map(e => {
      const s = [proj(e.a), proj(e.b)].sort((x, y) => x - y);
      return { e, s0: s[0], s1: s[1] };
    });

  let lo = Math.min(proj(seed.a), proj(seed.b));
  let hi = Math.max(proj(seed.a), proj(seed.b));
  const chosen = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const it of items) {
      if (chosen.has(it)) continue;
      if (Math.min(hi, it.s1) - Math.max(lo, it.s0) <= LINE_EPS) continue;
      chosen.add(it);
      lo = Math.min(lo, it.s0);
      hi = Math.max(hi, it.s1);
      grew = true;
    }
  }

  const verts = new Map();
  for (const it of chosen) {
    verts.set(`${it.e.ci}:${it.e.i}`, { ci: it.e.ci, vi: it.e.i });
    verts.set(`${it.e.ci}:${it.e.j}`, { ci: it.e.ci, vi: it.e.j });
  }
  return {
    normal, origin: p0,
    verts: [...verts.values()],
    edges: [...chosen].map(it => it.e),
  };
}

/** 直線 (p,d) と (q,e) の交点。平行なら null */
function lineIntersect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + s * d[0], p[1] + s * d[1]];
}

/** その頂点が乗っているページ外枠（複数の場合は角） */
function bordersOf(v) {
  const out = [];
  if (Math.abs(v[0]) < LINE_EPS) out.push({ q: [0, 0], e: [0, 1] });
  if (Math.abs(v[0] - PAGE_W) < LINE_EPS) out.push({ q: [PAGE_W, 0], e: [0, 1] });
  if (Math.abs(v[1]) < LINE_EPS) out.push({ q: [0, 0], e: [1, 0] });
  if (Math.abs(v[1] - PAGE_H) < LINE_EPS) out.push({ q: [0, PAGE_H], e: [1, 0] });
  return out;
}

/** 指定位置にある動かせる線を探す */
function findLineAt(ptNorm) {
  const p = toPage(ptNorm);
  let best = null;
  for (const e of allEdges()) {
    if (onPageBorder(e)) continue;
    const dist = distToSegment(p, e.a, e.b);
    if (dist < LINE_GRAB && (!best || dist < best.dist)) best = { e, dist };
  }
  return best ? buildLineGroup(best.e) : null;
}

/**
 * その線を消せるか調べる。
 *
 * 消すとは、線の両側のコマを1つに統合すること。したがって
 * **その線に接するコマがちょうど2つ**で、かつ両者が完全に同じ辺を
 * 共有しているときだけ消せる。
 *
 * 3つ以上のコマに接する線（「上1コマ＋下3コマ」の横線など）は、
 * 消した結果の形が一意に決まらないので対象外。その場合は先に
 * 下段の縦線を消してコマ数を減らせば、消せるようになる。
 */
function deletableLine(group) {
  const cellIds = [...new Set(group.edges.map(e => e.ci))];
  if (cellIds.length < 2) {
    return { ok: false, reason: 'この線はコマの境界ではありません（重ねゴマの辺など）。消すのではなく、そのコマ自体を削除してください。' };
  }
  if (cellIds.length > 2) {
    return {
      ok: false,
      reason: `この線には ${cellIds.length} コマが接しています。消せるのは2コマの境界だけです。`
        + '先に交わる線を消してコマを減らすと、この線も消せるようになります。',
    };
  }
  const [a, b] = cellIds;
  const sh = sharedEdge(ed.cells[a], ed.cells[b]);
  if (!sh) {
    return { ok: false, reason: '2つのコマが辺を完全には共有していないため、統合できません。' };
  }
  return { ok: true, keep: Math.min(a, b), drop: Math.max(a, b), a, b, sh };
}

/* 線を動かして作れるコマの最小の辺（ページ座標）。
   面積だけで見ると、細長い帯のようなコマが作れてしまうため縦横で見る。 */
const MIN_SIDE = 6;

/**
 * 線を法線方向へ平行移動した結果を返す。
 * はみ出す・コマが潰れる場合は null（その位置には動かせない）。
 */
function moveLine(group, deltaNorm) {
  const dp = [deltaNorm[0] * PAGE_W, deltaNorm[1] * PAGE_H];
  const n = group.normal;
  const t = dp[0] * n[0] + dp[1] * n[1];

  // 移動後の直線
  const p1 = [group.origin[0] + n[0] * t, group.origin[1] + n[1] * t];
  const dir = [-n[1], n[0]];
  const inside = q => q[0] >= -LINE_EPS && q[0] <= PAGE_W + LINE_EPS
                   && q[1] >= -LINE_EPS && q[1] <= PAGE_H + LINE_EPS;

  const next = clone(ed.cells);
  for (const { ci, vi } of group.verts) {
    const v = toPage(ed.cells[ci][vi]);
    const borders = bordersOf(v);

    let moved;
    if (borders.length === 0) {
      // 内側の頂点はそのまま法線方向へ
      moved = [v[0] + n[0] * t, v[1] + n[1] * t];
    } else {
      // 外枠に接する頂点は枠に沿ってスライドさせる。
      // 法線方向に動かすとページの外へ出てしまうため。
      for (const b of borders) {
        const hit = lineIntersect(p1, dir, b.q, b.e);
        if (hit && inside(hit)) { moved = hit; break; }
      }
    }
    if (!moved || !inside(moved)) return null;

    const clamp = (val, max) => Math.min(max, Math.max(0, val));
    next[ci][vi] = [
      round6(clamp(moved[0], PAGE_W) / PAGE_W),
      round6(clamp(moved[1], PAGE_H) / PAGE_H),
    ];
  }
  for (const ci of new Set(group.verts.map(v => v.ci))) {
    const b = bboxOf(next[ci]);
    if ((b.x1 - b.x0) * PAGE_W < MIN_SIDE) return null;
    if ((b.y1 - b.y0) * PAGE_H < MIN_SIDE) return null;
  }
  return next;
}

/** ドラッグから重ねゴマの矩形を決める */
function planOverlay(drag) {
  const x0 = Math.min(drag.from[0], drag.to[0]);
  const x1 = Math.max(drag.from[0], drag.to[0]);
  const y0 = Math.min(drag.from[1], drag.to[1]);
  const y1 = Math.max(drag.from[1], drag.to[1]);
  if (x1 - x0 < 0.06 || y1 - y0 < 0.05) return null;
  return rect(x0, y0, x1 - x0, y1 - y0);
}

/**
 * そのコマを消してもページに穴が空かないか。
 * 残りのコマだけでページを覆えるなら消せる = 重ねゴマである、ということ。
 * 敷き詰めたコマを消すと穴が残るので、それは許さない。
 */
function isRemovable(index) {
  const rest = ed.cells.reduce((s, c, i) => i === index ? s : s + polyArea(c), 0);
  return rest >= 0.999;
}

/** 指定位置にある「動かせる重ねゴマ」を探す（上に描かれているものを優先） */
function findOverlayAt(pt) {
  for (let i = ed.cells.length - 1; i >= 0; i--) {
    if (pointInPoly(pt, ed.cells[i]) && isRemovable(i)) return i;
  }
  return -1;
}

/** コマ全体を平行移動する。ページからはみ出す分は端で止める */
function moveCell(index, deltaNorm) {
  const b = bboxOf(ed.cells[index]);
  const dx = Math.min(1 - b.x1, Math.max(-b.x0, deltaNorm[0]));
  const dy = Math.min(1 - b.y1, Math.max(-b.y0, deltaNorm[1]));
  const next = clone(ed.cells);
  next[index] = next[index].map(([x, y]) => [round6(x + dx), round6(y + dy)]);
  return next;
}

function samePoly(a, b) {
  return a.length === b.length
    && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);
}

/* ---------- 描画 ---------- */

function editorSvg(preview) {
  const parts = [];
  parts.push(`<rect class="page-bg" x="0" y="0" width="${PAGE_W}" height="${PAGE_H}"/>`);

  // 線・コマの移動中は移動後の形を直接見せる
  const cells = preview && (preview.kind === 'line' || preview.kind === 'move')
    ? preview.cells : ed.cells;

  // 描く順は配列の並び（＝重ね順）。番号は読み順から引く
  const labels = readingLabels(cells, ed.readIndex);

  cells.forEach((cell, i) => {
    const scaled = cell.map(([x, y]) => [x * PAGE_W, y * PAGE_H]);
    const shaped = inset(scaled, GUTTER);
    const dim = preview && preview.kind === 'split' && preview.target === i;
    const picked = (ed.mode === 'order' && ed.pick === i)
                || (ed.mode === 'overlay' && ed.overlayPick === i);
    parts.push(
      `<polygon class="cell${dim ? ' cell-dim' : ''}${picked ? ' cell-picked' : ''}" ` +
      `points="${shaped.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}"/>`
    );
    if (!dim) {
      const [cx, cy] = centroid(shaped);
      parts.push(
        `<text class="cell-no" x="${round(cx)}" y="${round(cy)}" ` +
        `text-anchor="middle" dominant-baseline="central">${labels[i]}</text>`
      );
    }
  });

  if (preview && preview.kind === 'split') {
    for (const poly of preview.parts) {
      const scaled = poly.map(([x, y]) => [x * PAGE_W, y * PAGE_H]);
      const shaped = inset(scaled, GUTTER);
      parts.push(
        `<polygon class="cell-preview" ` +
        `points="${shaped.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}"/>`
      );
    }
  } else if (preview && preview.kind === 'overlay') {
    const scaled = preview.poly.map(([x, y]) => [x * PAGE_W, y * PAGE_H]);
    parts.push(
      `<polygon class="cell-preview" ` +
      `points="${scaled.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}"/>`
    );
  }

  // 選択中／つかんでいる／つかめる線を、コマの隙間に重ねて示す
  const drawLine = (group, cls, src) => {
    for (const e of group.edges) {
      if (!src[e.ci]) continue;
      const a = toPage(src[e.ci][e.i]);
      const b = toPage(src[e.ci][e.j]);
      parts.push(
        `<line class="${cls}" x1="${round(a[0])}" y1="${round(a[1])}" ` +
        `x2="${round(b[0])}" y2="${round(b[1])}"/>`
      );
    }
  };

  if (ed.mode === 'line' && ed.linePick && !ed.drag) {
    drawLine(ed.linePick.group, 'line-picked', ed.cells);
  }
  const marked = preview && preview.kind === 'line' ? preview.group
    : (ed.mode === 'line' && !ed.drag ? ed.hoverLine : null);
  if (marked) {
    drawLine(marked, 'line-handle',
      preview && preview.kind === 'line' ? preview.cells : ed.cells);
  }

  return parts.join('');
}

function currentPreview() {
  if (!ed.drag) return null;
  if (ed.mode === 'line') {
    if (!ed.drag.group) return null;
    const delta = [ed.drag.to[0] - ed.drag.from[0], ed.drag.to[1] - ed.drag.from[1]];
    const cells = moveLine(ed.drag.group, delta) || ed.drag.lastValid;
    return cells ? { kind: 'line', cells, group: ed.drag.group } : null;
  }
  if (ed.mode === 'overlay') {
    if (ed.drag.moveIndex != null) {
      const delta = [ed.drag.to[0] - ed.drag.from[0], ed.drag.to[1] - ed.drag.from[1]];
      return { kind: 'move', index: ed.drag.moveIndex, cells: moveCell(ed.drag.moveIndex, delta) };
    }
    const poly = planOverlay(ed.drag);
    return poly ? { kind: 'overlay', poly } : null;
  }
  const plan = planSplit(ed.drag, ed.drag.freeAngle);
  return plan ? { kind: 'split', ...plan } : null;
}

function refreshEditor() {
  const svg = document.getElementById('ed-canvas');
  svg.innerHTML = editorSvg(currentPreview());
  svg.classList.toggle('ed-canvas-order', ed.mode === 'order');
  svg.classList.toggle('ed-canvas-line', ed.mode === 'line');
  renderAnalysis();
  document.getElementById('ed-undo').disabled = ed.history.length === 0;
  document.getElementById('ed-auto-order').disabled = !ed.manualOrder;
  document.getElementById('ed-delete-cell').disabled =
    ed.overlayPick == null || !isRemovable(ed.overlayPick);
  document.getElementById('ed-delete-line').disabled = !ed.linePick?.merge?.ok;
}

/* ---------- 自動整理の表示 ---------- */

function renderAnalysis() {
  const n = ed.cells.length;
  const boxes = ed.cells.map(bboxOf);
  const sig = signatureFromBoxes(boxes);
  const tags = autoTags(ed.cells);
  const inRange = n >= 2 && n <= 7;

  const similar = allLayouts().filter(l => l.panels === n && l.sig === sig);

  document.getElementById('ed-analysis').innerHTML = `
    <dl class="stat-list">
      <div><dt>コマ数</dt><dd>${n}${inRange ? '' : ' <span class="warn">（保存は2〜7コマ）</span>'}</dd></div>
      <div><dt>段構成シグネチャ</dt><dd><code>${sig || '—'}</code></dd></div>
      <div><dt>読み順</dt><dd>${ed.manualOrder
        ? '手動で調整済み'
        : '自動（右上 → 左 → 下段）'}${ed.pick != null
          ? ` <span class="warn">— ${readingLabels(ed.cells, ed.readIndex)[ed.pick]} を選択中。入れ替え先をクリック</span>`
          : ''}</dd></div>
      <div><dt>自動タグ</dt><dd>${
        tags.length
          ? tags.map(t => `<span class="tag tag-${t}">${TAGS[t].label}</span>`).join(' ')
          : '—'}</dd></div>
      <div><dt>同じ構成の既存パターン</dt><dd>${
        similar.length
          ? similar.map(l => `<a href="#" data-open="${l.id}">${escapeHtml(displayName(l))}</a>`).join('、')
          : 'なし（新しい構成です）'}</dd></div>
    </dl>`;

  document.querySelectorAll('#ed-analysis a[data-open]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); openDetail(a.dataset.open); });
  });

  document.getElementById('ed-save').disabled = !inRange;
}

/* ---------- 操作 ---------- */

function toNorm(e, svg) {
  const r = svg.getBoundingClientRect();
  return [
    Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  ];
}

/** 線を選び、消せるかどうかを伝える */
function selectLine(group) {
  const status = document.getElementById('ed-status');
  ed.linePick = group ? { group, merge: deletableLine(group) } : null;

  if (!ed.linePick) {
    status.className = 'ed-status';
    status.textContent = '';
  } else if (ed.linePick.merge.ok) {
    status.className = 'ed-status';
    status.textContent = '線を選びました。「選択した線を消す」で両側のコマを1つにできます。';
  } else {
    status.className = 'ed-status err';
    status.textContent = ed.linePick.merge.reason;
  }
  refreshEditor();
}

function commitDrag() {
  const preview = currentPreview();
  if (!preview) {
    const wasLineMode = ed.mode === 'line';
    ed.drag = null;
    if (wasLineMode) selectLine(null); else refreshEditor();
    return;
  }

  // 形だけが変わる操作。コマの添字は動かないので読み順もそのまま
  if (preview.kind === 'line') {
    const dist = Math.hypot(ed.drag.to[0] - ed.drag.from[0], ed.drag.to[1] - ed.drag.from[1]);
    const group = ed.drag.group;
    ed.drag = null;
    // ほぼ動いていないなら「線を選ぶだけ」の操作とみなす
    if (dist < 0.01) { selectLine(group); return; }
    pushHistory();
    ed.linePick = null;
    setCells(preview.cells, ed.readIndex);
    return;
  }

  if (preview.kind === 'move') {
    const dist = Math.hypot(ed.drag.to[0] - ed.drag.from[0], ed.drag.to[1] - ed.drag.from[1]);
    ed.drag = null;
    // ほぼ動いていないなら「選ぶだけ」の操作とみなす
    if (dist < 0.01) { refreshEditor(); return; }
    pushHistory();
    setCells(preview.cells, ed.readIndex);
    return;
  }

  pushHistory();
  const t = preview.target;
  const next = ed.cells.slice();
  let readIndex;

  if (preview.kind === 'split') {
    // 分割した2コマは元のコマと同じ層に置く（重ね順は保つ）
    const sub = readingOrderIndices(preview.parts);
    next.splice(t, 1, ...preview.parts);
    // t より後ろの添字は1つずれる。元のコマの読み順位置に2コマを差し込む
    readIndex = ed.readIndex.flatMap(i =>
      i === t ? sub.map(k => t + k) : [i > t ? i + 1 : i]);
  } else {
    // 重ねゴマは一番手前に足し、読み順は末尾に置く
    next.push(preview.poly);
    readIndex = ed.readIndex.concat([next.length - 1]);
  }

  ed.drag = null;
  setCells(next, readIndex);
}

/**
 * ページ全体を変形する（反転など）。
 * 反転すると読み順の前提が変わるため、必ず自動判定に戻す。
 * 手動で調整していた場合はその旨を伝える（元に戻すで復帰できる）。
 */
function applyTransform(transform, label) {
  pushHistory();
  const wasManual = ed.manualOrder;
  ed.manualOrder = false;
  ed.pick = null;
  ed.linePick = null;
  ed.overlayPick = null;
  setCells(transform(ed.cells));

  const status = document.getElementById('ed-status');
  status.className = 'ed-status';
  status.textContent = wasManual
    ? `${label}しました。読み順は自動判定に振り直しています（「元に戻す」で調整前に復帰）。`
    : `${label}しました。`;
}

/** 読み順モードのクリック処理。2つ選ぶと入れ替える */
function handleOrderClick(pt) {
  let hit = -1;
  for (let i = ed.cells.length - 1; i >= 0; i--) {
    if (pointInPoly(pt, ed.cells[i])) { hit = i; break; }
  }
  if (hit < 0) { ed.pick = null; refreshEditor(); return; }

  if (ed.pick === null) {
    ed.pick = hit;
  } else if (ed.pick === hit) {
    ed.pick = null;
  } else {
    pushHistory();
    // 入れ替えるのは読み順だけ。コマ配列は触らないので重ね順は変わらない
    const next = ed.readIndex.slice();
    const pa = next.indexOf(ed.pick);
    const pb = next.indexOf(hit);
    [next[pa], next[pb]] = [next[pb], next[pa]];
    ed.readIndex = next;
    ed.manualOrder = true;
    ed.pick = null;
  }
  refreshEditor();
}

function initEditor() {
  const svg = document.getElementById('ed-canvas');

  svg.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = toNorm(e, svg);
    if (ed.mode === 'order') { handleOrderClick(p); return; }
    try { svg.setPointerCapture(e.pointerId); } catch { /* 捕捉できなくても操作は続く */ }
    ed.drag = { from: p, to: p, freeAngle: ed.mode === 'split' && (ed.snap ? e.shiftKey : !e.shiftKey) };
    if (ed.mode === 'line') {
      ed.drag.group = findLineAt(p);
      ed.drag.lastValid = null;
    }
    if (ed.mode === 'overlay') {
      // 既にある重ねゴマの上なら移動、それ以外なら新規作成
      const hit = findOverlayAt(p);
      if (hit >= 0) {
        ed.drag.moveIndex = hit;
        ed.overlayPick = hit;
      } else {
        ed.overlayPick = null;
      }
    }
    refreshEditor();
  });

  svg.addEventListener('pointermove', e => {
    const p = toNorm(e, svg);
    if (!ed.drag) {
      // つかめる線を先に光らせておく
      if (ed.mode === 'line') {
        const found = findLineAt(p);
        const same = !!found === !!ed.hoverLine
          && (!found || found.edges[0].ci === ed.hoverLine.edges[0].ci);
        ed.hoverLine = found;
        if (!same) refreshEditor();
      }
      return;
    }
    ed.drag.to = p;
    ed.drag.freeAngle = ed.mode === 'split' && (ed.snap ? e.shiftKey : !e.shiftKey);
    if (ed.mode === 'line' && ed.drag.group) {
      const delta = [p[0] - ed.drag.from[0], p[1] - ed.drag.from[1]];
      const moved = moveLine(ed.drag.group, delta);
      if (moved) ed.drag.lastValid = moved;   // 動かせない位置では直前の形を保つ
    }
    refreshEditor();
  });

  const end = e => {
    if (!ed.drag) return;
    ed.drag.to = toNorm(e, svg);
    commitDrag();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', () => { ed.drag = null; refreshEditor(); });

  document.getElementById('ed-undo').addEventListener('click', () => {
    const prev = ed.history.pop();
    if (!prev) return;
    ed.cells = prev.cells;
    ed.readIndex = prev.readIndex;
    ed.manualOrder = prev.manualOrder;
    ed.pick = null;
    ed.linePick = null;
    ed.overlayPick = null;
    refreshEditor();
  });

  document.getElementById('ed-clear').addEventListener('click', () => {
    pushHistory();
    ed.manualOrder = false;
    ed.pick = null;
    ed.linePick = null;
    ed.overlayPick = null;
    setCells([rect(0, 0, 1, 1)]);
  });

  document.getElementById('ed-delete-line').addEventListener('click', () => {
    const pick = ed.linePick;
    if (!pick || !pick.merge.ok) return;
    const { keep, drop, a, b, sh } = pick.merge;

    const merged = mergePolygons(ed.cells[a], ed.cells[b], sh);
    const expected = polyArea(ed.cells[a]) + polyArea(ed.cells[b]);
    if (merged.length < 3 || Math.abs(polyArea(merged) - expected) > 1e-4) {
      const status = document.getElementById('ed-status');
      status.className = 'ed-status err';
      status.textContent = 'この2コマは統合できませんでした（形が単純な多角形になりません）。';
      return;
    }

    pushHistory();
    const next = ed.cells.slice();
    next[keep] = merged;
    next.splice(drop, 1);

    // 統合後のコマは、2つのうち先に読む方の位置を引き継ぐ
    const ri = ed.readIndex.slice();
    const pk = ri.indexOf(keep), pd = ri.indexOf(drop);
    const lo = Math.min(pk, pd), hi = Math.max(pk, pd);
    ri.splice(hi, 1);
    ri[lo] = keep;

    ed.linePick = null;
    ed.hoverLine = null;
    setCells(next, ri.map(k => k > drop ? k - 1 : k));

    const status = document.getElementById('ed-status');
    status.className = 'ed-status ok';
    status.textContent = `線を消して2コマを1つにしました（${next.length}コマ）。`;
  });

  document.getElementById('ed-delete-cell').addEventListener('click', () => {
    const i = ed.overlayPick;
    if (i == null || !isRemovable(i)) return;
    pushHistory();
    ed.overlayPick = null;
    // 消したコマより後ろの添字は1つ前にずれる
    const readIndex = ed.readIndex.filter(k => k !== i).map(k => k > i ? k - 1 : k);
    setCells(ed.cells.filter((_, k) => k !== i), readIndex);
  });

  document.getElementById('ed-auto-order').addEventListener('click', () => {
    pushHistory();
    ed.manualOrder = false;
    ed.pick = null;
    setCells(ed.cells);
  });

  document.getElementById('ed-mirror-x')
    .addEventListener('click', () => applyTransform(mirrorCellsX, '左右反転'));
  document.getElementById('ed-flip-y')
    .addEventListener('click', () => applyTransform(flipCellsY, '上下反転'));

  document.getElementById('ed-snap').addEventListener('change', e => {
    ed.snap = e.target.checked;
  });

  svg.addEventListener('pointerleave', () => {
    if (ed.hoverLine) { ed.hoverLine = null; refreshEditor(); }
  });

  const HINTS = {
    split: 'コマの上をドラッグすると、その方向に分割線が入ります。Shift を押しながらで角度が自由になります。',
    overlay: '何もない所をドラッグすると、その範囲に重ねゴマを追加します。'
      + '既にある重ねゴマの上をドラッグすると移動、クリックで選択して「選択した重ねゴマを削除」で消せます。',
    line: '境界線に近づけると線が光ります。ドラッグで平行移動、クリックで選択して「選択した線を消す」で両側のコマを1つにできます。ページの外枠は動かせません。',
    order: 'コマを2つ順にクリックすると、その2つの読み順を入れ替えます。',
  };
  document.querySelectorAll('input[name="ed-mode"]').forEach(r => {
    r.addEventListener('change', e => {
      ed.mode = e.target.value;
      ed.pick = null;
      ed.hoverLine = null;
      ed.linePick = null;
      ed.overlayPick = null;
      document.getElementById('ed-hint').textContent = HINTS[ed.mode];
      refreshEditor();
    });
  });

  document.getElementById('ed-save').addEventListener('click', saveFromEditor);
  document.getElementById('ed-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveFromEditor();
  });

  refreshEditor();
}

function saveFromEditor() {
  const n = ed.cells.length;
  const status = document.getElementById('ed-status');
  if (n < 2 || n > 7) {
    status.className = 'ed-status err';
    status.textContent = 'このカタログは2〜7コマが対象です。分割を調整してください。';
    return;
  }

  const nameInput = document.getElementById('ed-name');
  const boxes = ed.cells.map(bboxOf);
  const sig = signatureFromBoxes(boxes);
  const name = nameInput.value.trim() || `自作 ${n}コマ（${sig}）`;

  customLayouts.push({
    id: 'custom-' + Date.now().toString(36),
    panels: n,
    name,
    cells: clone(ed.cells),
    readIndex: ed.readIndex.slice(),
    sig,
    tags: autoTags(ed.cells),
    note: 'エディタで作成したパターン。タグと段構成は形状から自動判定しています。',
    est: null,
    custom: true,
    createdAt: new Date().toISOString(),
  });
  persistCustomLayouts();

  nameInput.value = '';
  status.className = 'ed-status ok';
  status.textContent = `「${name}」をカタログに追加しました（${n}コマ / ${sig}）。`;

  renderGrid();
  renderAnalysis();
}

/** カタログ詳細から編集用に読み込む */
function loadIntoEditor(layout) {
  pushHistory();
  // 元のパターンが持つ読み順と重ね順をそのまま引き継ぐ（自動整列で書き換えない）
  ed.manualOrder = true;
  ed.pick = null;
  ed.linePick = null;
  ed.overlayPick = null;
  const cells = clone(layout.cells);
  setCells(cells, isValidReadIndex(layout.readIndex, cells.length)
    ? layout.readIndex.slice()
    : cells.map((_, i) => i));
  document.getElementById('ed-name').value = layout.custom ? layout.name : layout.name + ' 改';
  document.getElementById('ed-status').textContent = '';
  document.getElementById('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
