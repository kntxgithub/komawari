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
    `aria-label="${escapeHtml(displayName(layout))}（${layout.panels}コマ）">`
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

  // 既定の並び。他の基準が並んだときの最終的なタイブレークにも使う
  const byEst = (a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0)
    || (b.est ?? 0) - (a.est ?? 0) || a.panels - b.panels;

  const sorters = {
    est: byEst,
    rating: (a, b) => ratingOf(b) - ratingOf(a) || byEst(a, b),
    manual: (a, b) => orderRank(a) - orderRank(b),
    panels: (a, b) => a.panels - b.panels || byEst(a, b),
    tiers: (a, b) => tierCount(a) - tierCount(b) || a.panels - b.panels || byEst(a, b),
    cols: (a, b) => colCount(a) - colCount(b) || a.panels - b.panels || byEst(a, b),
    name: (a, b) => displayName(a).localeCompare(displayName(b), 'ja'),
  };

  if (state.sort === 'manual') ensureOrder(allLayouts());
  return list.sort(sorters[state.sort] || byEst);
}

/* ---------- カード描画 ---------- */

function cardHtml(layout) {
  const scoreBadge = layout.custom
    ? ''
    : `<span class="badge badge-est">推定 ${layout.est}</span>`;
  const originBadge = layout.shared
    ? '<span class="badge badge-shared">共有</span>'
    : (layout.custom ? '<span class="badge badge-custom">自作</span>' : '');
  const rating = ratingOf(layout);
  const ratingBadge = rating
    ? `<span class="badge badge-rating" title="お気に入り度 ${rating}">★${rating}</span>`
    : '';
  const badge = originBadge + ratingBadge + scoreBadge;

  const tags = layout.tags
    .map(t => `<span class="tag tag-${t}">${TAGS[t].label}</span>`).join('');

  const structure = `${tierCount(layout)}段 / 最大${colCount(layout)}列`;

  return `
    <button class="card" data-id="${layout.id}" type="button">
      <div class="card-figure">${renderLayoutSvg(layout)}</div>
      <div class="card-body">
        <div class="card-head">
          <span class="count-chip">${layout.panels}コマ</span>
          ${badge}
        </div>
        <h3 class="card-title">${escapeHtml(displayName(layout))}</h3>
        <p class="card-structure">${structure}</p>
        <div class="card-tags">${tags}</div>
      </div>
    </button>`;
}

function renderGrid() {
  const list = visibleLayouts();
  const grid = document.getElementById('grid');
  grid.innerHTML = list.map(cardHtml).join('');
  grid.classList.toggle('grid-sortable', state.sort === 'manual');
  document.getElementById('result-count').textContent = `${list.length} 件`;

  grid.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => {
      // 並べ替えのドラッグ直後は詳細を開かない
      if (reorder.justDragged) { reorder.justDragged = false; return; }
      openDetail(el.dataset.id);
    });
  });

  document.getElementById('reorder-hint').hidden = state.sort !== 'manual';

  const empty = document.getElementById('empty');
  empty.hidden = list.length > 0;
  empty.textContent = state.counts.size === 0
    ? 'コマ数を選んでください。'
    : '条件に合うパターンがありません。タグの組み合わせを緩めてください。';
}

/* ---------- 手動並び順のドラッグ ---------- */

const reorder = { id: null, el: null, from: null, moved: false, justDragged: false };

function cardUnder(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.card') : null;
}

function clearDropMark() {
  document.querySelectorAll('.card-drop').forEach(el => el.classList.remove('card-drop'));
}

function initReorder() {
  const grid = document.getElementById('grid');

  grid.addEventListener('pointerdown', e => {
    if (state.sort !== 'manual' || e.button !== 0) return;
    const card = e.target.closest('.card');
    if (!card) return;
    reorder.id = card.dataset.id;
    reorder.el = card;
    reorder.from = [e.clientX, e.clientY];
    reorder.moved = false;
  });

  document.addEventListener('pointermove', e => {
    if (!reorder.id) return;
    if (!reorder.moved) {
      if (Math.hypot(e.clientX - reorder.from[0], e.clientY - reorder.from[1]) < 6) return;
      reorder.moved = true;
      reorder.el.classList.add('card-dragging');
    }
    clearDropMark();
    const over = cardUnder(e.clientX, e.clientY);
    if (over && over.dataset.id !== reorder.id) over.classList.add('card-drop');
  });

  document.addEventListener('pointerup', e => {
    if (!reorder.id) return;
    const { id, el, moved } = reorder;
    reorder.id = null;
    reorder.el = null;
    el.classList.remove('card-dragging');
    clearDropMark();
    if (!moved) return;

    reorder.justDragged = true;
    const over = cardUnder(e.clientX, e.clientY);
    if (over && over.dataset.id !== id && moveInOrder(id, over.dataset.id)) renderGrid();
  });
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
        siblings.map(s => escapeHtml(displayName(s))).join('、')}</p>
    </section>` : '';

  const rating = ratingOf(layout);
  const stars = Array.from({ length: MAX_RATING }, (_, i) => `
    <button type="button" class="star${i < rating ? ' star-on' : ''}"
            data-rate="${i + 1}" aria-label="お気に入り度 ${i + 1}">★</button>`).join('');

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
        <h3>${escapeHtml(displayName(layout))}</h3>
        <p class="detail-note">${escapeHtml(layout.note)}</p>
        <div class="card-tags">${layout.tags.map(t =>
          `<span class="tag tag-${t}" title="${escapeHtml(TAGS[t].desc)}">${TAGS[t].label}</span>`).join('')}</div>

        <div class="rename-row">
          <input type="text" id="rename-input" maxlength="60"
                 value="${escapeHtml(displayName(layout))}" aria-label="名前">
          <button type="button" class="btn-ghost" data-act="rename">名前を変更</button>
          ${meta.names[layout.id]
            ? '<button type="button" class="btn-link" data-act="rename-reset">元に戻す</button>'
            : ''}
        </div>

        <div class="rating-row">
          <span class="rating-label">お気に入り度</span>
          <span class="stars">${stars}</span>
          <button type="button" class="btn-link" data-act="rate-clear"
                  ${rating ? '' : 'hidden'}>クリア</button>
        </div>

        <dl class="stat-list">
          <div><dt>構造シグネチャ</dt><dd><code>${layout.sig}</code></dd></div>
          <div><dt>構成</dt><dd>${tierCount(layout)}段 / 最大${colCount(layout)}列 / ${layout.panels}コマ</dd></div>
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

  const applyRename = () => {
    setLayoutName(layout, dlg.querySelector('#rename-input').value);
    renderGrid();
    renderAnalysis();
    openDetail(id);   // 表示中の名前とボタンを描き直す
  };
  dlg.querySelector('[data-act="rename"]').addEventListener('click', applyRename);
  dlg.querySelector('#rename-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyRename(); }
  });
  dlg.querySelector('[data-act="rename-reset"]')?.addEventListener('click', () => {
    delete meta.names[layout.id];
    persistMeta();
    renderGrid();
    openDetail(id);
  });

  dlg.querySelectorAll('.star').forEach(btn => {
    btn.addEventListener('click', () => {
      setRating(layout, Number(btn.dataset.rate));
      renderGrid();
      openDetail(id);
    });
  });
  dlg.querySelector('[data-act="rate-clear"]')?.addEventListener('click', () => {
    setRating(layout, 0);
    renderGrid();
    openDetail(id);
  });

  if (!dlg.open) dlg.showModal();
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

  document.getElementById('reorder-reset').addEventListener('click', () => {
    resetOrder();
    ensureOrder(allLayouts());
    renderGrid();
  });

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
    const hasMeta = Object.keys(meta.names).length || Object.keys(meta.ratings).length
      || meta.order.length;
    if (customLayouts.length === 0 && !hasMeta) {
      status.className = 'sync-status err';
      status.textContent = '書き出すデータがありません。';
      return;
    }
    const n = exportPatterns();
    status.className = 'sync-status ok';
    status.textContent = `patterns.json を書き出しました（自作 ${n} 件`
      + (hasMeta ? '、名前・評価・並び順を含む' : '') + '）。';
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
        + (r.skipped ? `（重複・不正な ${r.skipped} 件は取り込まず）` : '')
        + (r.metaMerged ? `。名前・評価・並び順を ${r.metaMerged} 件反映` : '') + '。';
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
  initReorder();
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
