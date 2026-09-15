/* ============================================================
   首頁邏輯：載入節目清單並渲染節目卡片
   - 靜態 programs.json（內建，老師手動編輯）
   - /api/programs（KV 自訂，由「新增影片」寫入）
   兩者以 videoId 去重合併，靜態在前、自訂在後
   ============================================================ */
(function () {
  'use strict';

  const grid = document.getElementById('program-grid');
  const siteNameEl = document.getElementById('site-name');

  function esc(text) {
    const div = document.createElement('div');
    div.textContent = String(text == null ? '' : text);
    return div.innerHTML;
  }

  function renderCard(program) {
    const lang = program.lang || window.__DEFAULT_LANG__ || 'en';
    const href = 'player.html?id=' + encodeURIComponent(program.id);
    const desc = program.description || '';

    const card = document.createElement('a');
    card.className = 'program-card';
    card.href = href;
    card.innerHTML =
      '<div class="program-thumb">' +
        '<img src="https://i.ytimg.com/vi/' + encodeURIComponent(program.videoId) + '/hqdefault.jpg" alt="' + esc(program.title) + ' 縮圖" loading="lazy" onerror="this.style.opacity=0.25">' +
        '<span class="program-lang">' + esc(lang) + '</span>' +
        (program.custom ? '<span class="program-badge">自訂</span>' : '') +
      '</div>' +
      '<div class="program-body">' +
        '<h3>' + esc(program.title) + '</h3>' +
        (desc ? '<p>' + esc(desc) + '</p>' : '') +
      '</div>';
    return card;
  }

  async function fetchStatic() {
    try {
      const res = await fetch('programs.json', { cache: 'no-cache' });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  async function fetchCustom() {
    try {
      const res = await fetch('api/programs', { cache: 'no-cache' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.programs) ? data.programs : [];
    } catch (err) {
      return [];
    }
  }

  async function load() {
    const staticData = await fetchStatic();
    const custom = await fetchCustom();

    if (staticData && staticData.siteName) {
      siteNameEl.textContent = staticData.siteName;
      document.title = staticData.siteName;
    }
    window.__DEFAULT_LANG__ = (staticData && staticData.defaultLang) || window.__DEFAULT_LANG__ || 'en';

    const base = (staticData && Array.isArray(staticData.programs)) ? staticData.programs : [];
    const seen = {};
    const merged = [];
    base.concat(custom).forEach(function (p) {
      if (!p || !p.id || !p.videoId) return;
      if (seen[p.videoId]) return;
      seen[p.videoId] = true;
      merged.push(p);
    });
    return merged;
  }

  function render(programs) {
    grid.innerHTML = '';
    if (!programs.length) {
      const hint = document.createElement('div');
      hint.className = 'loading-hint error';
      hint.textContent = '節目清單是空的。請在 programs.json 加入節目，或用右上角「新增影片」加入。';
      grid.appendChild(hint);
      return;
    }
    const frag = document.createDocumentFragment();
    programs.forEach(function (p) { frag.appendChild(renderCard(p)); });
    grid.appendChild(frag);
  }

  async function reload() {
    const programs = await load();
    render(programs);
  }

  (async function init() {
    const loadingHint = document.getElementById('loading-hint');
    try {
      const programs = await load();
      if (loadingHint && loadingHint.parentNode) loadingHint.remove();
      render(programs);
    } catch (err) {
      if (loadingHint) {
        loadingHint.textContent = '無法載入節目清單（' + err.message + '）。';
        loadingHint.className = 'loading-hint error';
      }
    }
  })();

  window.Programs = { reload: reload };
})();
