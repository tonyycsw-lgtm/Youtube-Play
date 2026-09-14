/* ============================================================
   首頁邏輯：載入 programs.json 並渲染節目卡片
   ============================================================ */
(function () {
  'use strict';

  const grid = document.getElementById('program-grid');
  const loadingHint = document.getElementById('loading-hint');
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
      '</div>' +
      '<div class="program-body">' +
        '<h3>' + esc(program.title) + '</h3>' +
        (desc ? '<p>' + esc(desc) + '</p>' : '') +
      '</div>';
    return card;
  }

  async function init() {
    let data;
    try {
      const res = await fetch('programs.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (err) {
      loadingHint.textContent = '無法載入節目清單（' + err.message + '）。請確認已透過 HTTP 伺服器開啟（例如 Cloudflare Pages 或 python -m http.server），並確認 programs.json 存在。';
      loadingHint.className = 'loading-hint error';
      return;
    }

    if (data.siteName) {
      siteNameEl.textContent = data.siteName;
      document.title = data.siteName;
    }
    window.__DEFAULT_LANG__ = data.defaultLang || 'en';

    const programs = Array.isArray(data.programs) ? data.programs : [];
    if (!programs.length) {
      loadingHint.textContent = '節目清單是空的。請在 programs.json 中加入節目（格式見 README.md）。';
      loadingHint.className = 'loading-hint error';
      return;
    }

    loadingHint.remove();
    const frag = document.createDocumentFragment();
    programs.forEach(function (p) {
      if (!p.id || !p.videoId) return;
      frag.appendChild(renderCard(p));
    });
    grid.appendChild(frag);
  }

  init();
})();
