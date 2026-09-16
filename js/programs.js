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

  function isAdmin() {
    return !!(window.__LYOW__ && window.__LYOW__.isAdmin);
  }

  function thumbInner(source, program) {
    if (program.thumbnail) {
      return '<img src="' + esc(program.thumbnail) + '" alt="' + esc(program.title) + ' 封面" loading="lazy" onerror="this.style.opacity=0.25">';
    }
    if (source === 'youtube' && program.videoId) {
      return '<img src="https://i.ytimg.com/vi/' + encodeURIComponent(program.videoId) + '/hqdefault.jpg" alt="' + esc(program.title) + ' 縮圖" loading="lazy" onerror="this.style.opacity=0.25">';
    }
    var isAudio = (source === 'file' && program.mediaType === 'audio');
    var glyph = (source === 'tiktok' || source === 'douyin' || isAudio) ? '♪' : '▶';
    var label = source === 'tiktok' ? 'TikTok'
      : source === 'douyin' ? '抖音'
        : source === 'file' ? (isAudio ? '音頻' : '影片檔') : '';
    return '<div class="thumb-icon thumb-' + esc(source) + '">' +
      '<span class="thumb-glyph">' + glyph + '</span>' +
      (label ? '<span class="thumb-brand">' + label + '</span>' : '') +
      '</div>';
  }

  function renderCard(program) {
    const href = 'player?id=' + encodeURIComponent(program.id);
    const desc = program.description || '';
    const source = program.source || 'youtube';

    const card = document.createElement('a');
    card.className = 'program-card';
    card.href = href;
    card.innerHTML =
      '<div class="program-thumb">' + thumbInner(source, program) + '</div>' +
      '<div class="program-body">' +
        '<h3>' + esc(program.title) + '</h3>' +
        (desc ? '<p>' + esc(desc) + '</p>' : '') +
      '</div>';

    const item = document.createElement('div');
    item.className = 'program-item';
    item.appendChild(card);

    if (program.custom && isAdmin()) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'program-delete';
      del.title = '刪除此節目';
      del.textContent = '✕';
      del.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        deleteProgram(program);
      });
      item.appendChild(del);
    }
    return item;
  }

  async function deleteProgram(program) {
    if (!window.confirm('確定刪除「' + program.title + '」？')) return;
    try {
      const headers = {};
      const token = window.__LYOW__ ? await window.__LYOW__.getIdToken() : null;
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch('api/programs?id=' + encodeURIComponent(program.id), { method: 'DELETE', headers });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) {
        window.alert('刪除失敗：' + (data.note || data.error || ('HTTP ' + res.status)));
        return;
      }
      await reload();
    } catch (err) {
      window.alert('刪除失敗：' + err.message);
    }
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
      if (!p || !p.id) return;
      const key = p.videoId || p.id;
      if (seen[key]) return;
      seen[key] = true;
      merged.push(p);
    });
    return merged;
  }

  function render(programs) {
    grid.innerHTML = '';
    if (!programs.length) {
      const hint = document.createElement('div');
      hint.className = 'loading-hint error';
      hint.textContent = '節目清單是空的。請用右上角「新增影片」加入。';
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

  window.addEventListener('lyow-auth-ready', function () { reload(); });

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
