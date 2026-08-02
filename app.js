/* ============================================================
   コマ割りカタログ — UI
   ============================================================ */

/* PAGE_W / PAGE_H は geom.js が持つ */
const GUTTER = 1.4;   // コマ間の余白（viewBox 単位）

/* ---------- 状態 ---------- */

const state = {
  counts: new Set([2, 3, 4, 5, 6, 7]),
  tags: new Set(),
  sort: 'est',
  customOnly: false,
  selected: null,
};

/** シードパターン＋共有パターン＋自作パターン */
function allLayouts() {
  return LAYOUTS.concat(sharedLayouts, customLayouts);
}

/* ---------- SVG 描画 ---------- */

/** ポリゴンを重心方向に一定量だけ縮める（コマ間の白を作る） */
function inset(poly, amt) {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => [
    x + Math.sign(cx - x) * amt,
    y + Math.sign(cy - y) * amt,
  ]);
}

function centroid(poly) {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return [cx, cy];
}

function renderLayoutSvg(layout, { showNumbers = true } = {}) {
  const parts = [];
  parts.push(
    `<svg class="page" viewBox="0 0 ${PAGE_W} ${PAGE_H}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" ` +
    `aria-label="${escapeHtml(layout.name)}（${layout.panels}コマ）">`
  );
  parts.push(`<rect class="page-bg" x="0" y="0" width="${PAGE_W}" height="${PAGE_H}"/>`);

  // 配列の並びは重ね順。番号は読み順から引く
  const labels = readingLabels(layout.cells, layout.readIndex);

  layout.cells.forEach((cell, i) => {
    const scaled = cell.map(([x, y]) => [x * PAGE_W, y * PAGE_H]);
    const shaped = inset(scaled, GUTTER);
    const pts = shaped.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
    parts.push(`<polygon class="cell" points="${pts}"/>`);

    if (showNumbers) {
      const [cx, cy] = centroid(shaped);
      parts.push(
        `<text class="cell-no" x="${round(cx)}" y="${round(cy)}" ` +
        `text-anchor="middle" dominant-baseline="central">${labels[i]}</text>`
      );
    }
  });

  parts.push('</svg>');
  return parts.join('');
}

const round = n => Math.round(n * 100) / 100;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 絞り込み・並べ替え ---------- */

function visibleLayouts() {
  let list = allLayouts().filter(l => state.counts.has(l.panels));

  if (state.customOnly) list = list.filter(l => l.custom);

  if (state.tags.size > 0) {
    list = list.filter(l => [...state.tags].every(t => l.tags.includes(t)));
  }

  const sorters = {
    // 自作は推定スコアを持たないので先頭にまとめる
    est: (a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0)
      || (b.est ?? 0) - (a.est ?? 0) || a.panels - b.panels,
    panels: (a, b) => a.panels - b.panels || (b.est ?? 0) - (a.est ?? 0),
    name: (a, b) => a.name.localeCompare(b.name, 'ja'),
  };
  return list.sort(sorters[state.sort]);
}

/* ---------- カード描画 ---------- */

function cardHtml(layout) {
  const scoreBadge = layout.custom
    ? ''
    : `<span class="badge badge-est">推定 ${layout.est}</span>`;
  const originBadge = layout.shared
    ? '<span class="badge badge-shared">共有</span>'
    : (layout.custom ? '<span class="badge badge-custom">自作</span>' : '');
  const badge = originBadge + scoreBadge;

  const tags = layout.tags
    .map(t => `<span class="tag tag-${t}">${TAGS[t].label}</span>`).join('');

  return `
    <button class="card" data-id="${layout.id}" type="button">
      <div class="card-figure">${renderLayoutSvg(layout)}</div>
      <div class="card-body">
        <div class="card-head">
          <span class="count-chip">${layout.panels}コマ</span>
          ${badge}
        </div>
        <h3 class="card-title">${escapeHtml(layout.name)}</h3>
        <div class="card-tags">${tags}</div>
      </div>
    </button>`;
}

function renderGrid() {
  const list = visibleLayouts();
  const grid = document.getElementById('grid');
  grid.innerHTML = list.map(cardHtml).join('');
  document.getElementById('result-count').textContent = `${list.length} 件`;

  grid.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });

  const empty = document.getElementById('empty');
  empty.hidden = list.length > 0;
  empty.textContent = state.counts.size === 0
    ? 'コマ数を選んでください。'
    : '条件に合うパターンがありません。タグの組み合わせを緩めてください。';
}

/* ---------- 詳細 ---------- */

function openDetail(id) {
  const layout = allLayouts().find(l => l.id === id);
  if (!layout) return;
  state.selected = layout;

  const siblings = allLayouts().filter(
    l => l.sig === layout.sig && l.panels === layout.panels && l.id !== layout.id);

  const siblingBlock = siblings.length ? `
    <section class="detail-section">
      <h4>同じ段構成のパターン</h4>
      <p class="note">構造シグネチャ <code>${layout.sig}</code> は次のパターンとも一致します: ${
        siblings.map(s => escapeHtml(s.name)).join('、')}</p>
    </section>` : '';

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-figure">${renderLayoutSvg(layout)}</div>
      <div class="detail-info">
        <div class="card-head">
          <span class="count-chip">${layout.panels}コマ</span>
          ${layout.shared
            ? '<span class="badge badge-shared">共有</span>'
            : layout.custom
              ? '<span class="badge badge-custom">自作</span>'
              : `<span class="badge badge-est">推定スコア ${layout.est}</span>`}
        </div>
        <h3>${escapeHtml(layout.name)}</h3>
        <p class="detail-note">${escapeHtml(layout.note)}</p>
        <div class="card-tags">${layout.tags.map(t =>
          `<span class="tag tag-${t}" title="${escapeHtml(TAGS[t].desc)}">${TAGS[t].label}</span>`).join('')}</div>
        <dl class="stat-list">
          <div><dt>構造シグネチャ</dt><dd><code>${layout.sig}</code></dd></div>
          <div><dt>読み順</dt><dd>右上 → 左 → 下段</dd></div>
        </dl>
        <div class="detail-actions">
          <button type="button" class="btn-ghost" data-act="edit">この構成をエディタで開く</button>
          ${layout.custom && !layout.shared
            ? '<button type="button" class="btn-ghost btn-danger" data-act="delete">削除</button>'
            : ''}
          ${layout.shared
            ? '<span class="note">共有パターンです。消すにはリポジトリの patterns.json を編集してください。</span>'
            : ''}
        </div>
      </div>
    </div>
    ${siblingBlock}`;

  const dlg = document.getElementById('detail');
  dlg.querySelector('[data-act="edit"]').addEventListener('click', () => {
    dlg.close();
    loadIntoEditor(layout);
  });
  dlg.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
    deleteCustomLayout(layout.id);
    dlg.close();
    renderGrid();
    renderAnalysis();
  });

  dlg.showModal();
}

/* ---------- フィルタ UI ---------- */

function buildFilters() {
  const countBox = document.getElementById('count-filters');
  countBox.innerHTML = [2, 3, 4, 5, 6, 7].map(n => `
    <label class="chip">
      <input type="checkbox" value="${n}" checked>
      <span>${n}コマ</span>
    </label>`).join('');

  countBox.addEventListener('change', e => {
    const n = Number(e.target.value);
    e.target.checked ? state.counts.add(n) : state.counts.delete(n);
    renderGrid();
  });

  const setAllCounts = on => {
    state.counts = on ? new Set([2, 3, 4, 5, 6, 7]) : new Set();
    countBox.querySelectorAll('input').forEach(i => { i.checked = on; });
    renderGrid();
  };
  document.getElementById('count-none').addEventListener('click', () => setAllCounts(false));
  document.getElementById('count-all').addEventListener('click', () => setAllCounts(true));

  const tagBox = document.getElementById('tag-filters');
  tagBox.innerHTML = Object.entries(TAGS).map(([key, t]) => `
    <label class="chip" title="${escapeHtml(t.desc)}">
      <input type="checkbox" value="${key}">
      <span>${t.label}</span>
    </label>`).join('');

  tagBox.addEventListener('change', e => {
    const k = e.target.value;
    e.target.checked ? state.tags.add(k) : state.tags.delete(k);
    renderGrid();
  });

  const customOnly = document.getElementById('custom-only');
  customOnly.addEventListener('change', e => {
    state.customOnly = e.target.checked;
    renderGrid();
  });

  document.getElementById('sort').addEventListener('change', e => {
    state.sort = e.target.value;
    renderGrid();
  });

  document.getElementById('reset').addEventListener('click', () => {
    state.counts = new Set([2, 3, 4, 5, 6, 7]);
    state.tags.clear();
    state.sort = 'est';
    state.customOnly = false;
    countBox.querySelectorAll('input').forEach(i => { i.checked = true; });
    tagBox.querySelectorAll('input').forEach(i => { i.checked = false; });
    customOnly.checked = false;
    document.getElementById('sort').value = 'est';
    renderGrid();
  });
}

/* ---------- 持ち出し・持ち込み ---------- */

function buildSync() {
  const status = document.getElementById('sync-status');

  document.getElementById('export-patterns').addEventListener('click', () => {
    if (customLayouts.length === 0) {
      status.className = 'sync-status err';
      status.textContent = '書き出す自作パターンがありません。';
      return;
    }
    const n = exportPatterns();
    status.className = 'sync-status ok';
    status.textContent = `patterns.json を書き出しました（自作 ${n} 件）。`;
  });

  const input = document.getElementById('import-patterns');
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    try {
      const json = JSON.parse(await input.files[0].text());
      const r = importPatterns(json);
      renderGrid();
      renderAnalysis();
      status.className = 'sync-status ok';
      status.textContent = `${r.added} 件を追加しました`
        + (r.skipped ? `（重複・不正な ${r.skipped} 件は取り込まず）` : '') + '。';
    } catch (e) {
      status.className = 'sync-status err';
      status.textContent = `失敗: ${e.message}`;
    } finally {
      input.value = '';
    }
  });
}

/* ---------- 起動 ---------- */

async function init() {
  buildFilters();
  buildSync();
  renderGrid();
  initEditor();

  // 共有パターンは取得を待たずに描画し、届いたら差し替える
  await loadSharedPatterns();
  if (sharedLayouts.length) {
    renderGrid();
    renderAnalysis();
  }

  const dlg = document.getElementById('detail');
  document.getElementById('detail-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
}

document.addEventListener('DOMContentLoaded', init);
