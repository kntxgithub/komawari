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
  measured: loadStats(),
  selected: null,
};

/** シードパターン＋自作パターン */
function allLayouts() {
  return LAYOUTS.concat(customLayouts);
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

  layout.cells.forEach((cell, i) => {
    const scaled = cell.map(([x, y]) => [x * PAGE_W, y * PAGE_H]);
    const shaped = inset(scaled, GUTTER);
    const pts = shaped.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
    parts.push(`<polygon class="cell" points="${pts}"/>`);

    if (showNumbers) {
      const [cx, cy] = centroid(shaped);
      parts.push(
        `<text class="cell-no" x="${round(cx)}" y="${round(cy)}" ` +
        `text-anchor="middle" dominant-baseline="central">${i + 1}</text>`
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

/* ---------- 実測データ参照 ---------- */

/** このパターンと同じ構造シグネチャが、同コマ数ページ中で占める割合 */
function measuredShare(layout) {
  const m = state.measured;
  if (!m) return null;
  const denom = m.byCount[layout.panels];
  if (!denom) return null;
  const hit = m.bySig[layout.sig]?.byCount?.[layout.panels] || 0;
  return { share: hit / denom, hit, denom };
}

/** そのコマ数のページが全体に占める割合 */
function measuredCountShare(n) {
  const m = state.measured;
  if (!m || !m.countedPages) return null;
  return (m.byCount[n] || 0) / m.countedPages;
}

function measuredLargeRate(n) {
  const m = state.measured;
  if (!m || !m.byCount[n]) return null;
  return (m.largeByCount[n] || 0) / m.byCount[n];
}

const pct = v => (v * 100).toFixed(1) + '%';

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
    measured: (a, b) => {
      const ma = measuredShare(a)?.share ?? -1;
      const mb = measuredShare(b)?.share ?? -1;
      return mb - ma || (b.est ?? 0) - (a.est ?? 0);
    },
    panels: (a, b) => a.panels - b.panels || (b.est ?? 0) - (a.est ?? 0),
    name: (a, b) => a.name.localeCompare(b.name, 'ja'),
  };
  return list.sort(sorters[state.sort]);
}

/* ---------- カード描画 ---------- */

function cardHtml(layout) {
  const m = measuredShare(layout);
  const scoreBadge = state.measured
    ? (m
      ? `<span class="badge badge-measured" title="構造シグネチャ ${layout.sig} が ${layout.panels}コマページ ${m.denom} 件中 ${m.hit} 件">実測 ${pct(m.share)}</span>`
      : `<span class="badge badge-none">実測データなし</span>`)
    : (layout.custom
      ? ''
      : `<span class="badge badge-est">推定 ${layout.est}</span>`);
  const badge = (layout.custom ? '<span class="badge badge-custom">自作</span>' : '') + scoreBadge;

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

  document.getElementById('empty').hidden = list.length > 0;
}

/* ---------- 詳細 ---------- */

function openDetail(id) {
  const layout = allLayouts().find(l => l.id === id);
  if (!layout) return;
  state.selected = layout;

  const m = measuredShare(layout);
  const countShare = measuredCountShare(layout.panels);
  const largeRate = measuredLargeRate(layout.panels);

  const siblings = allLayouts().filter(
    l => l.sig === layout.sig && l.panels === layout.panels && l.id !== layout.id);

  const measuredBlock = state.measured ? `
    <section class="detail-section">
      <h4>実測データ（取り込み済み）</h4>
      <dl class="stat-list">
        <div><dt>この構造の出現率</dt><dd>${m ? `${pct(m.share)} <small>(${m.hit} / ${m.denom} ページ)</small>` : '該当なし'}</dd></div>
        <div><dt>${layout.panels}コマページの割合</dt><dd>${countShare != null ? pct(countShare) : '—'}</dd></div>
        <div><dt>${layout.panels}コマ中の大ゴマ率</dt><dd>${largeRate != null ? pct(largeRate) : '—'}</dd></div>
      </dl>
      ${siblings.length ? `<p class="note">構造シグネチャ <code>${layout.sig}</code> は次のパターンとも一致します（実測値は共通）: ${siblings.map(s => escapeHtml(s.name)).join('、')}</p>` : ''}
      <p class="note">実測はコマの外接矩形に基づくため、<strong>斜め分割や重ねゴマは判別できません</strong>。段構成とコマ数のみの統計です。</p>
    </section>` : `
    <section class="detail-section">
      <h4>実測データ</h4>
      <p class="note">未取り込みです。下部の「実測データを取り込む」から Manga109 のアノテーション XML を読み込むと、この構造の実際の出現率が表示されます。</p>
    </section>`;

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-figure">${renderLayoutSvg(layout)}</div>
      <div class="detail-info">
        <div class="card-head">
          <span class="count-chip">${layout.panels}コマ</span>
          ${layout.custom
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
          ${layout.custom
            ? '<button type="button" class="btn-ghost btn-danger" data-act="delete">削除</button>'
            : ''}
        </div>
      </div>
    </div>
    ${measuredBlock}`;

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

/* ---------- 取り込み UI ---------- */

function buildImporter() {
  const status = document.getElementById('import-status');
  const input = document.getElementById('xml-input');

  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    const splitSpread = document.getElementById('split-spread').checked;
    status.className = 'import-status working';
    status.textContent = '読み込み中…';

    try {
      const { stats, errors } = await importFiles(
        input.files, { splitSpread },
        (i, total, name) => { status.textContent = `読み込み中 ${i}/${total}: ${name}`; }
      );
      saveStats(stats);
      state.measured = stats;
      state.sort = 'measured';
      document.getElementById('sort').value = 'measured';
      renderMeasuredSummary();
      renderGrid();
      renderAnalysis();

      status.className = 'import-status ok';
      status.textContent =
        `${stats.books.length} 冊 / ${stats.totalPages} ページを解析。` +
        `うち 2〜7コマ: ${stats.countedPages} ページ。` +
        (errors.length ? ` 失敗 ${errors.length} 件: ${errors[0]}` : '');
    } catch (e) {
      status.className = 'import-status err';
      status.textContent = `失敗: ${e.message}`;
    } finally {
      input.value = '';
    }
  });

  document.getElementById('clear-measured').addEventListener('click', () => {
    clearStats();
    state.measured = null;
    if (state.sort === 'measured') {
      state.sort = 'est';
      document.getElementById('sort').value = 'est';
    }
    renderMeasuredSummary();
    renderGrid();
    renderAnalysis();
    status.className = 'import-status';
    status.textContent = '実測データを削除しました。';
  });
}

function renderMeasuredSummary() {
  const box = document.getElementById('measured-summary');
  const m = state.measured;
  const sortOpt = document.querySelector('#sort option[value="measured"]');

  if (!m) {
    box.hidden = true;
    sortOpt.disabled = true;
    document.getElementById('clear-measured').hidden = true;
    document.getElementById('data-mode').textContent = '推定値のみ';
    document.getElementById('data-mode').className = 'mode-badge mode-est';
    return;
  }

  box.hidden = false;
  sortOpt.disabled = false;
  document.getElementById('clear-measured').hidden = false;
  document.getElementById('data-mode').textContent = '実測データあり';
  document.getElementById('data-mode').className = 'mode-badge mode-measured';

  const rows = [2, 3, 4, 5, 6, 7].map(n => {
    const c = m.byCount[n] || 0;
    const share = m.countedPages ? c / m.countedPages : 0;
    const large = c ? (m.largeByCount[n] || 0) / c : 0;
    return { n, c, share, large };
  });
  const max = Math.max(...rows.map(r => r.share), 0.0001);

  box.innerHTML = `
    <h3>実測サマリー <small>${m.books.length} 冊 / ${m.countedPages} ページ（2〜7コマ）</small></h3>
    <table class="summary-table">
      <thead><tr><th>コマ数</th><th>ページ数</th><th>割合</th><th>大ゴマ率</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.n}</td>
            <td>${r.c}</td>
            <td>
              <span class="bar" style="--w:${(r.share / max * 100).toFixed(1)}%"></span>
              <span class="bar-val">${pct(r.share)}</span>
            </td>
            <td>${r.c ? pct(r.large) : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="note">除外: 0〜1コマ・8コマ以上のページ ${m.outOfRange} 件（扉・見開き等を含む）。</p>`;
}

/* ---------- 起動 ---------- */

function init() {
  buildFilters();
  buildImporter();
  renderMeasuredSummary();
  renderGrid();
  initEditor();

  const dlg = document.getElementById('detail');
  document.getElementById('detail-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
}

document.addEventListener('DOMContentLoaded', init);
