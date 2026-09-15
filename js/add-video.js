/* ============================================================
   首頁「新增影片」：
   - 分頁一：貼連結（YouTube／TikTok／媒體檔 URL；自動判斷來源、抓標題）
   - 分頁二：上載詞匯 JSON（自動讀取網址/標題並轉成播放頁格式）
   - 送出 → POST /api/programs（存 Cloudflare KV）
   ============================================================ */
(function () {
  'use strict';

  var modal = document.getElementById('add-modal');
  var openBtn = document.getElementById('btn-add-video');
  var form = document.getElementById('add-form');
  var msgEl = document.getElementById('add-msg');
  var submitBtn = document.getElementById('add-submit');
  var urlEl = document.getElementById('add-url');
  var fileEl = document.getElementById('add-json-file');
  var jsonHint = document.getElementById('json-hint');
  var titleEl = document.getElementById('add-title');
  var langEl = document.getElementById('add-lang');
  var descEl = document.getElementById('add-desc');

  if (!modal || !openBtn || !form) return;

  var state = {
    tab: 'link',
    jsonResolved: null,
    jsonTitle: '',
    jsonVocab: null,
    busy: false
  };

  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var VIDEO_EXT = ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v', 'mkv'];
  var AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'oga'];

  /* ---------- 連結解析 ---------- */
  function extractVideoId(input) {
    if (!input) return '';
    var s = String(input).trim();
    if (!s) return '';
    if (VIDEO_ID_RE.test(s)) return s;
    var m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    try {
      var u = new URL(s);
      var v = u.searchParams.get('v');
      if (v && VIDEO_ID_RE.test(v)) return v;
      var parts = u.pathname.split('/').filter(Boolean);
      var last = parts[parts.length - 1] || '';
      if (VIDEO_ID_RE.test(last)) return last;
    } catch (e) { /* 非完整網址 */ }
    return '';
  }

  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }

  function fileNameFromUrl(u) {
    try {
      var parts = new URL(u).pathname.split('/').filter(Boolean);
      var last = parts[parts.length - 1] || '';
      return decodeURIComponent(last) || u;
    } catch (e) { return u; }
  }

  /* ---------- 來源判斷：youtube | tiktok | file ---------- */
  function resolveUrl(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (!s) return null;
    var yt = extractVideoId(s);
    if (yt) return { source: 'youtube', id: yt, videoId: yt };
    var tt = s.match(/tiktok\.com\/(?:@[^/]+\/video|player\/v1|v)\/(\d{6,25})/i);
    if (tt) return { source: 'tiktok', id: 'tt_' + tt[1], videoId: tt[1], url: s };
    var m = s.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
    var ext = m ? m[1].toLowerCase() : '';
    if (VIDEO_EXT.indexOf(ext) !== -1 || AUDIO_EXT.indexOf(ext) !== -1) {
      return {
        source: 'file',
        id: 'f_' + hash(s),
        src: s,
        mediaType: VIDEO_EXT.indexOf(ext) !== -1 ? 'video' : 'audio'
      };
    }
    return null;
  }

  /* ---------- 時間範圍解析 ---------- */
  function toSec(t) {
    var parts = String(t || '').trim().split(':');
    if (!parts.length) return NaN;
    var s = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = Number(parts[i]);
      if (isNaN(n)) return NaN;
      s = s * 60 + n;
    }
    return s;
  }

  function parseRange(str) {
    var parts = String(str || '').split(/[-–—~]/);
    if (parts.length < 2) return { start: 0, end: 0 };
    var start = toSec(parts[0]);
    var end = toSec(parts[1]);
    if (isNaN(start) || isNaN(end)) return { start: 0, end: 0 };
    return { start: start, end: end };
  }

  /* ---------- 詞匯 JSON 轉成播放頁格式 ---------- */
  function convertVocab(data) {
    if (!data || typeof data !== 'object') return null;

    if (Array.isArray(data.segments)) {
      var segs = data.segments.map(function (seg) {
        var words = (seg.words || []).map(function (it) {
          if (typeof it === 'string') return { w: it, src: it, zh: '' };
          var w = String(it.w || it.word || '').toLowerCase().trim();
          return { w: w, src: String(it.src || w), zh: it.zh || '' };
        }).filter(function (it) { return it.w; });
        return {
          start: +seg.start || 0,
          end: +seg.end || 0,
          en: seg.en || seg.englishSentence || seg.sentence || '',
          zh: seg.zh || seg.chineseTranslation || seg.translation || '',
          words: words
        };
      }).filter(function (seg) { return seg.end > seg.start; });
      if (!segs.length) return null;
      return { window: +data.window || 10, segments: segs };
    }

    if (Array.isArray(data.wordSegments)) {
      var segs2 = data.wordSegments.map(function (seg) {
        var r = parseRange(seg.timeRange);
        var words = (seg.vocabularies || []).map(function (v) {
          var w = String(v.word || '').toLowerCase().trim();
          return { w: w, src: w, zh: v.meaning || '' };
        }).filter(function (it) { return it.w; });
        return {
          start: r.start,
          end: r.end,
          en: seg.englishSentence || '',
          zh: seg.chineseTranslation || '',
          words: words
        };
      }).filter(function (seg) { return seg.end > seg.start; });
      if (!segs2.length) return null;
      return { window: 10, segments: segs2 };
    }

    return null;
  }

  /* ---------- 讀取 JSON 檔 ---------- */
  function readJsonFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('讀取檔案失敗')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  /* ---------- oEmbed 抓標題（YouTube / TikTok） ---------- */
  async function fetchOembed(resolved) {
    if (!resolved) return null;
    var q;
    if (resolved.source === 'youtube') q = 'v=' + encodeURIComponent(resolved.videoId);
    else if (resolved.source === 'tiktok') q = 'url=' + encodeURIComponent(resolved.url || ('https://www.tiktok.com/@i/video/' + resolved.videoId));
    else return null;
    try {
      var res = await fetch('api/oembed?' + q, { cache: 'no-cache' });
      if (!res.ok) return null;
      var data = await res.json();
      return (data && data.ok) ? data : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------- UI 輔助 ---------- */
  function setTab(name) {
    state.tab = name;
    modal.querySelectorAll('.modal-tab').forEach(function (t) {
      t.classList.toggle('on', t.getAttribute('data-tab') === name);
    });
    modal.querySelectorAll('.tab-pane').forEach(function (p) {
      p.hidden = p.getAttribute('data-pane') !== name;
    });
    hideMsg();
  }

  function showMsg(text, type) {
    msgEl.textContent = text;
    msgEl.className = 'modal-msg' + (type ? ' ' + type : '');
    msgEl.hidden = false;
  }

  function hideMsg() {
    msgEl.hidden = true;
    msgEl.textContent = '';
  }

  function setBusy(busy) {
    state.busy = busy;
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? '新增中…' : '新增';
  }

  function showToast(text) {
    var el = document.getElementById('home-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'home-toast';
      el.className = 'osd';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('active');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.remove('active'); }, 2200);
  }

  function resetForm() {
    form.reset();
    langEl.value = 'en';
    state.jsonResolved = null;
    state.jsonTitle = '';
    state.jsonVocab = null;
    jsonHint.textContent = '會自動讀取影片網址與標題；支援 segments 與 wordSegments 兩種詞匯格式。';
    jsonHint.classList.remove('ok', 'error');
    hideMsg();
  }

  function openModal() {
    resetForm();
    setTab('link');
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(function () { urlEl.focus(); }, 30);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  /* ---------- 事件綁定 ---------- */
  openBtn.addEventListener('click', openModal);

  modal.querySelectorAll('[data-close]').forEach(function (el) {
    el.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  modal.querySelectorAll('.modal-tab').forEach(function (t) {
    t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); });
  });

  var oembedTimer = null;
  urlEl.addEventListener('input', function () {
    clearTimeout(oembedTimer);
    var r = resolveUrl(urlEl.value);
    if (!r) return;
    oembedTimer = setTimeout(async function () {
      if (titleEl.value.trim()) return;
      var info = await fetchOembed(r);
      if (info && info.title && !titleEl.value.trim()) titleEl.value = info.title;
    }, 450);
  });

  fileEl.addEventListener('change', async function () {
    var file = fileEl.files && fileEl.files[0];
    if (!file) return;
    jsonHint.classList.remove('ok', 'error');
    jsonHint.textContent = '讀取中…';
    try {
      var text = await readJsonFile(file);
      var data = JSON.parse(text);
      var url = (data.videoInfo && data.videoInfo.url) || data.src || '';
      var resolved = resolveUrl(url) || resolveUrl(data.videoId || '');
      var title = (data.videoInfo && data.videoInfo.title) || data.title || '';
      var vocab = convertVocab(data);

      state.jsonResolved = resolved;
      state.jsonTitle = title;
      state.jsonVocab = vocab;

      if (title && !titleEl.value.trim()) titleEl.value = title;
      if (resolved && !urlEl.value.trim()) {
        urlEl.value = resolved.source === 'file'
          ? resolved.src
          : (resolved.source === 'youtube' ? ('https://youtu.be/' + resolved.videoId) : (resolved.url || ('https://www.tiktok.com/@i/video/' + resolved.videoId)));
      }

      if (!resolved) {
        jsonHint.textContent = '已讀取，但找不到可辨識的影片網址；請手動填入連結或媒體檔 URL。';
        jsonHint.classList.add('error');
      } else if (!vocab) {
        jsonHint.textContent = '已讀取（' + resolved.id + '），但詞匯格式無法辨識；仍可新增影片。';
        jsonHint.classList.add('error');
      } else {
        jsonHint.textContent = '已讀取：' + resolved.id + '，共 ' + vocab.segments.length + ' 段詞匯。';
        jsonHint.classList.add('ok');
      }
    } catch (e) {
      state.jsonResolved = null;
      state.jsonTitle = '';
      state.jsonVocab = null;
      jsonHint.textContent = '無法解析 JSON：' + (e && e.message ? e.message : e);
      jsonHint.classList.add('error');
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (state.busy) return;
    hideMsg();

    var resolved = resolveUrl(urlEl.value) || state.jsonResolved;
    if (!resolved) {
      showMsg('請提供有效的 YouTube／TikTok 連結、媒體檔 URL（mp4/mp3…），或上載含影片網址的 JSON。', 'error');
      return;
    }

    var title = titleEl.value.trim() || state.jsonTitle || '';
    if (!title) {
      var info = await fetchOembed(resolved);
      title = (info && info.title) || (resolved.source === 'file' ? fileNameFromUrl(resolved.src) : resolved.id);
      titleEl.value = title;
    }

    var payload = {
      id: resolved.id,
      source: resolved.source,
      title: title,
      lang: langEl.value.trim() || 'en',
      description: descEl.value.trim()
    };
    if (resolved.videoId) payload.videoId = resolved.videoId;
    if (resolved.src) { payload.src = resolved.src; payload.mediaType = resolved.mediaType; }
    if (state.jsonVocab) payload.vocab = state.jsonVocab;

    setBusy(true);
    try {
      var res = await fetch('api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function () { return {}; });

      if (!res.ok || !data.ok) {
        showMsg((data.note || '新增失敗') + '（' + (data.error || ('HTTP ' + res.status)) + '）', 'error');
        setBusy(false);
        return;
      }

      closeModal();
      showToast((data.updated ? '已更新：' : '已新增：') + title + (data.vocabSaved ? '（含詞匯）' : ''));
      if (window.Programs && window.Programs.reload) await window.Programs.reload();
    } catch (err) {
      showMsg('網路錯誤：' + (err && err.message ? err.message : err), 'error');
    }
    setBusy(false);
  });
})();
