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
  cells: [rect(0, 0, 1, 1)],
  history: [],
  mode: 'split',   // 'split' | 'overlay'
  snap: true,
  drag: null,      // { from:[x,y], to:[x,y] }
};

const clone = cells => cells.map(c => c.map(p => [p[0], p[1]]));

function pushHistory() {
  ed.history.push(clone(ed.cells));
  if (ed.history.length > 60) ed.history.shift();
}

function setCells(cells) {
  ed.cells = sortToReadingOrder(cells);
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

/** ドラッグから重ねゴマの矩形を決める */
function planOverlay(drag) {
  const x0 = Math.min(drag.from[0], drag.to[0]);
  const x1 = Math.max(drag.from[0], drag.to[0]);
  const y0 = Math.min(drag.from[1], drag.to[1]);
  const y1 = Math.max(drag.from[1], drag.to[1]);
  if (x1 - x0 < 0.06 || y1 - y0 < 0.05) return null;
  return rect(x0, y0, x1 - x0, y1 - y0);
}

/* ---------- 描画 ---------- */

function editorSvg(preview) {
  const parts = [];
  parts.push(`<rect class="page-bg" x="0" y="0" width="${PAGE_W}" height="${PAGE_H}"/>`);

  ed.cells.forEach((cell, i) => {
    const scaled = cell.map(([x, y]) => [x * PAGE_W, y * PAGE_H]);
    const shaped = inset(scaled, GUTTER);
    const dim = preview && preview.kind === 'split' && preview.target === i;
    parts.push(
      `<polygon class="cell${dim ? ' cell-dim' : ''}" ` +
      `points="${shaped.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}"/>`
    );
    if (!dim) {
      const [cx, cy] = centroid(shaped);
      parts.push(
        `<text class="cell-no" x="${round(cx)}" y="${round(cy)}" ` +
        `text-anchor="middle" dominant-baseline="central">${i + 1}</text>`
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

  return parts.join('');
}

function currentPreview() {
  if (!ed.drag) return null;
  if (ed.mode === 'overlay') {
    const poly = planOverlay(ed.drag);
    return poly ? { kind: 'overlay', poly } : null;
  }
  const plan = planSplit(ed.drag, ed.drag.freeAngle);
  return plan ? { kind: 'split', ...plan } : null;
}

function refreshEditor() {
  document.getElementById('ed-canvas').innerHTML = editorSvg(currentPreview());
  renderAnalysis();
  document.getElementById('ed-undo').disabled = ed.history.length === 0;
}

/* ---------- 自動整理の表示 ---------- */

function renderAnalysis() {
  const n = ed.cells.length;
  const boxes = ed.cells.map(bboxOf);
  const sig = signatureFromBoxes(boxes);
  const tags = autoTags(ed.cells);
  const inRange = n >= 2 && n <= 7;

  const similar = allLayouts().filter(l => l.panels === n && l.sig === sig);
  const measured = measuredShareFor(n, sig);

  document.getElementById('ed-analysis').innerHTML = `
    <dl class="stat-list">
      <div><dt>コマ数</dt><dd>${n}${inRange ? '' : ' <span class="warn">（保存は2〜7コマ）</span>'}</dd></div>
      <div><dt>段構成シグネチャ</dt><dd><code>${sig || '—'}</code></dd></div>
      <div><dt>自動タグ</dt><dd>${
        tags.length
          ? tags.map(t => `<span class="tag tag-${t}">${TAGS[t].label}</span>`).join(' ')
          : '—'}</dd></div>
      <div><dt>同じ構成の既存パターン</dt><dd>${
        similar.length
          ? similar.map(l => `<a href="#" data-open="${l.id}">${escapeHtml(l.name)}</a>`).join('、')
          : 'なし（新しい構成です）'}</dd></div>
      ${measured != null
        ? `<div><dt>この構成の実測出現率</dt><dd>${pct(measured)}</dd></div>`
        : ''}
    </dl>`;

  document.querySelectorAll('#ed-analysis a[data-open]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); openDetail(a.dataset.open); });
  });

  document.getElementById('ed-save').disabled = !inRange;
}

/** コマ数とシグネチャから実測出現率を引く（未取り込みなら null） */
function measuredShareFor(n, sig) {
  const m = state.measured;
  if (!m || !m.byCount?.[n]) return null;
  return (m.bySig?.[sig]?.byCount?.[n] || 0) / m.byCount[n];
}

/* ---------- 操作 ---------- */

function toNorm(e, svg) {
  const r = svg.getBoundingClientRect();
  return [
    Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  ];
}

function commitDrag() {
  const preview = currentPreview();
  if (!preview) { ed.drag = null; refreshEditor(); return; }

  pushHistory();
  if (preview.kind === 'split') {
    const next = ed.cells.filter((_, i) => i !== preview.target).concat(preview.parts);
    ed.drag = null;
    setCells(next);
  } else {
    const next = ed.cells.concat([preview.poly]);
    ed.drag = null;
    setCells(next);
  }
}

function initEditor() {
  const svg = document.getElementById('ed-canvas');

  svg.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch { /* 捕捉できなくても操作は続く */ }
    const p = toNorm(e, svg);
    ed.drag = { from: p, to: p, freeAngle: ed.mode === 'split' && (ed.snap ? e.shiftKey : !e.shiftKey) };
    refreshEditor();
  });

  svg.addEventListener('pointermove', e => {
    if (!ed.drag) return;
    ed.drag.to = toNorm(e, svg);
    ed.drag.freeAngle = ed.mode === 'split' && (ed.snap ? e.shiftKey : !e.shiftKey);
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
    if (prev) { ed.cells = prev; refreshEditor(); }
  });

  document.getElementById('ed-clear').addEventListener('click', () => {
    pushHistory();
    setCells([rect(0, 0, 1, 1)]);
  });

  document.getElementById('ed-snap').addEventListener('change', e => {
    ed.snap = e.target.checked;
  });

  document.querySelectorAll('input[name="ed-mode"]').forEach(r => {
    r.addEventListener('change', e => {
      ed.mode = e.target.value;
      document.getElementById('ed-hint').textContent = ed.mode === 'split'
        ? 'コマの上をドラッグすると、その方向に分割線が入ります。Shift を押しながらで角度が自由になります。'
        : 'ドラッグした範囲に重ねゴマを追加します。';
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
  setCells(clone(layout.cells));
  document.getElementById('ed-name').value = layout.custom ? layout.name : layout.name + ' 改';
  document.getElementById('ed-status').textContent = '';
  document.getElementById('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
