/* ============================================================
   播放頁主邏輯：播放器生命週期、A-B 循環、詞匯面板、快捷鍵、匯出
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var params = new URLSearchParams(location.search);
  var programId = params.get('id');
  var directV = params.get('v');

  var TICK_MS = 250;          // 時間輪詢週期
  var SPEEDS = [0.5, 0.75, 0.85, 1.0, 1.25];
  var LS_PREFIX = 'utube_web_v1:';
  var SUB_FONT_MIN = 14;
  var SUB_FONT_MAX = 34;
  var SUB_HEIGHT_MIN = 48;
  var SUB_HEIGHT_MAX = 220;
  var SUB_HEIGHT_DEFAULT = 76;
  var LS_SUBHEIGHT = LS_PREFIX + 'subheight';

  var App = {
    program: null,
    id: '',               // 節目 id（詞匯 key 用）
    source: 'youtube',    // youtube | file | tiktok
    videoId: '',
    src: '',              // file 來源的媒體 URL
    mediaType: 'video',   // video | audio
    title: '',
    lang: 'en',
    player: null,         // 播放器轉接器（Player Adapter）
    ready: false,
    noTimeControl: false,
    duration: 0,
    speed: 1,
    fadeEnabled: true,
    vocab: [],            // [ { start, end, words: [ { w, zh } ] } ]
    vocabSource: 'none',  // json | none
    segIndex: -1,
    pinned: null,
    searching: false,
    subHeight: SUB_HEIGHT_DEFAULT,
    hasSubtitle: false,
    pendingSeek: null,
    pendingUntil: 0,
    tickTimer: null,
    osdTimer: null
  };

  /* ================= 節目查詢（靜態優先，找不到再查 KV） ================= */
  async function findProgram(id) {
    var defaultLang = 'en';
    var p = null;
    try {
      var res = await fetch('programs.json', { cache: 'no-cache' });
      if (res.ok) {
        var data = await res.json();
        defaultLang = data.defaultLang || defaultLang;
        p = (data.programs || []).find(function (x) { return x.id === id; }) || null;
      }
    } catch (e) { /* 靜態清單不存在時仍可查 KV */ }
    if (!p) {
      try {
        var res2 = await fetch('api/programs', { cache: 'no-cache' });
        if (res2.ok) {
          var d2 = await res2.json();
          p = (d2.programs || []).find(function (x) { return x.id === id; }) || null;
        }
      } catch (e) { /* 無 API 時略過 */ }
    }
    return { program: p, defaultLang: defaultLang };
  }

  /* ================= 初始化 ================= */
  async function init() {
    if (programId) {
      var found = await findProgram(programId);
      var p = found.program;
      if (!p || (!p.videoId && !p.src)) { showFatal('找不到節目'); return; }
      App.program = p;
      App.source = p.source || 'youtube';
      App.id = p.id || p.videoId;
      App.videoId = p.videoId || '';
      App.src = p.src || '';
      App.mediaType = p.mediaType === 'audio' ? 'audio' : 'video';
      App.title = p.title || '影片';
      App.lang = p.lang || found.defaultLang || 'en';
    } else if (directV) {
      App.source = 'youtube';
      App.id = directV;
      App.videoId = directV;
      App.title = 'YouTube 影片';
      App.lang = params.get('lang') || 'en';
    } else {
      showFatal('缺少影片參數（id 或 v）');
      return;
    }

    document.title = App.title + ' — 影片學習站';
    $('page-title').textContent = App.title;
    if (App.program && App.program.description) {
      $('page-desc').textContent = App.program.description;
    }
    setupMediaArea();
    loadSubHeight();
    bindUI();
    loadPlayer();
  }

  function setupMediaArea() {
    if (App.source === 'file' && App.mediaType === 'audio') {
      $('video-wrap').classList.add('audio-mode');
      $('audio-stage').hidden = false;
      $('audio-title').textContent = App.title;
    }
  }

  function showFatal(msg) {
    var el = $('player-error');
    el.textContent = msg;
    el.hidden = false;
  }

  /* ================= 播放器載入（依來源選轉接器） ================= */
  function loadPlayer() {
    if (App.source === 'file') { createFilePlayer(); return; }
    if (App.source === 'tiktok') { createTikTokPlayer(); return; }
    if (App.source === 'douyin') { createDouyinPlayer(); return; }
    createYouTubePlayer();
  }

  function createYouTubePlayer() {
    if (window.YT && window.YT.Player) { buildYouTube(); return; }
    window.onYouTubeIframeAPIReady = buildYouTube;
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    var first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(tag, first);
    setTimeout(function () {
      if (!App.ready && !(window.YT && window.YT.Player)) {
        showFatal('無法載入 YouTube 播放器。請檢查網路，或學校網路是否封鎖 youtube.com。');
      }
    }, 9000);
  }

  function buildYouTube() {
    try {
      App.player = window.Players.createYouTube({
        container: $('player'),
        videoId: App.videoId,
        lang: App.lang,
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      });
    } catch (e) { showFatal('播放器初始化失敗：' + e.message); }
  }

  function createFilePlayer() {
    try {
      App.player = window.Players.createHtml5({
        container: App.mediaType === 'audio' ? $('audio-player-slot') : $('player'),
        src: App.src,
        mediaType: App.mediaType,
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      });
    } catch (e) { showFatal('播放器初始化失敗：' + e.message); }
  }

  function createTikTokPlayer() {
    try {
      App.player = window.Players.createTikTok({
        container: $('player'),
        postId: App.videoId,
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      });
    } catch (e) { showFatal('播放器初始化失敗：' + e.message); }
  }

  function createDouyinPlayer() {
    try {
      App.player = window.Players.createDouyin({
        container: $('player'),
        videoId: App.videoId,
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      });
    } catch (e) { showFatal('播放器初始化失敗：' + e.message); }
  }

  function onPlayerReady() {
    if (App.ready) return;
    App.ready = true;
    if (App.player && App.player.supportsTime === false) {
      App.noTimeControl = true;
      document.body.classList.add('watch-only');
      var note = $('watch-only-note');
      if (note) note.hidden = false;
      return;
    }
    App.duration = App.player.getDuration() || 0;
    restoreState();
    applySpeed();
    applySubtitleHeight();
    updateTimeLabels();
    updatePlayhead(0);
    window.focus();
    document.body.focus();
    loadVocabulary();
    App.tickTimer = setInterval(tick, TICK_MS);
  }

  function onPlayerStateChange() { /* A-B 循環已移除 */ }

  function onPlayerError() {
    showOSD('✕ 影片無法播放（可能受地區或年齡限制，或連結不允許嵌入）', '#F59E0B', 2600);
  }

  /* ================= 時間輪詢 ================= */
  function syncDuration() {
    if (!App.player) return;
    var d = App.player.getDuration() || 0;
    if (d <= 0 || Math.abs(d - App.duration) < 0.5) return;
    App.duration = d;
    updateTimeLabels();
  }

  function tick() {
    if (!App.ready || !App.player || App.noTimeControl) return;
    syncDuration();
    var t = App.player.getCurrentTime();
    if (!isFinite(t)) return;

    if (App.pendingSeek != null) {
      if (Math.abs(t - App.pendingSeek) < 1.0 || Date.now() > App.pendingUntil) {
        App.pendingSeek = null;
      } else {
        t = App.pendingSeek;
      }
    }

    $('txt-now').textContent = formatTime(t);
    updatePlayhead(t);
    updateSegment(t);
  }

  /* ================= 詞匯載入（唯一來源：KV / api/vocab/{id}） ================= */
  async function loadVocabulary() {
    var res = await window.Vocab.load(App.id);
    App.vocab = (res && res.segments) || [];
    App.vocabSource = (res && res.source) || 'none';
    App.hasSubtitle = App.vocab.some(function (s) { return s.en || s.zh; });
    $('subtitle-bar').hidden = !App.hasSubtitle;
    App.segIndex = -1;
    App.pinned = null;
    renderPinned();

    if (!App.vocab.length) {
      $('vocab-list').innerHTML = '<div class="vocab-empty">目前沒有可用的詞匯。' +
        '<br><br>請老師在首頁「新增影片」上載詞匯 JSON。</div>';
      $('seg-label').textContent = '--:-- – --:--';
      return;
    }
    var t = App.player ? App.player.getCurrentTime() : 0;
    var idx = segmentIndexAt(t);
    if (idx >= 0) renderSegment(idx); else clearSegment();
  }

  /* ---------- 段落索引 ---------- */
  function segmentIndexAt(st) {
    var segs = App.vocab;
    if (!segs.length) return -1;
    if (st < segs[0].start) return -1;
    var idx = -1;
    for (var i = 0; i < segs.length; i++) {
      if (st >= segs[i].start) idx = i;
      else break;
    }
    return idx;
  }

  function updateSegment(t) {
    if (App.searching || !App.vocab.length) return;
    var i = segmentIndexAt(t);
    if (i < 0) {
      if (App.segIndex !== -1) clearSegment();
      return;
    }
    if (i !== App.segIndex) renderSegment(i);
  }

  /* 尚未到第一段：清空字幕與詞匯 */
  function clearSegment() {
    App.segIndex = -1;
    App.pinned = null;
    renderPinned();
    renderSubtitle(null);
    $('seg-label').textContent = '--:-- – --:--';
    if (App.vocab.length) {
      $('vocab-list').innerHTML = '<div class="vocab-empty">尚未到第一段（' + formatClock(App.vocab[0].start) + ' 開始）。</div>';
    }
  }

  /* ---------- 渲染目前段落 ---------- */
  function renderSegment(i) {
    if (!App.vocab.length) return;
    App.searching = false;
    i = clamp(i, 0, App.vocab.length - 1);
    var changed = i !== App.segIndex;
    App.segIndex = i;
    var seg = App.vocab[i];

    $('seg-label').textContent = formatClock(seg.start) + ' – ' + formatClock(seg.end);
    renderSubtitle(seg);

    if (changed) {
      App.pinned = null;
      renderPinned();
    }

    var list = $('vocab-list');
    var frag = document.createDocumentFragment();
    if (!seg.words.length) {
      var empty = document.createElement('div');
      empty.className = 'vocab-empty';
      empty.textContent = '此段沒有可顯示的詞匯。';
      frag.appendChild(empty);
    } else {
      seg.words.forEach(function (word) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vocab-chip';
        btn.textContent = wordLabel(word);
        btn.dataset.w = word.w;
        if (App.pinned && App.pinned.w === word.w) btn.classList.add('active');
        btn.addEventListener('click', function () { selectWord(word); });
        frag.appendChild(btn);
      });
    }
    list.innerHTML = '';
    list.appendChild(frag);
  }

  /* ---------- 字幕詞匯：斷詞、比對、渲染 ---------- */
  var IRREGULAR = {
    brought: 'bring', gave: 'give', given: 'give', shook: 'shake', shaken: 'shake',
    sold: 'sell', sank: 'sink', sunk: 'sink', sent: 'send', left: 'leave',
    felt: 'feel', kept: 'keep', held: 'hold', told: 'tell', thought: 'think',
    found: 'find', made: 'make', took: 'take', came: 'come', got: 'get',
    went: 'go', saw: 'see', said: 'say', knew: 'know', wrote: 'write',
    spoke: 'speak', grew: 'grow', fell: 'fall', met: 'meet', built: 'build',
    spent: 'spend', heard: 'hear', meant: 'mean', lost: 'lose', won: 'win',
    became: 'become', began: 'begin', ran: 'run', sat: 'sit', stood: 'stand',
    children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
    mice: 'mouse', people: 'person', shelves: 'shelf', wolves: 'wolf',
    leaves: 'leaf', lives: 'life', knives: 'knife', wives: 'wife'
  };

  function tokenCandidates(tok) {
    var s = String(tok || '').toLowerCase().replace(/^'+|'+$/g, '');
    var out = {};
    function add(x) { if (x && x.length >= 2) out[x] = true; }
    add(s);
    if (IRREGULAR[s]) add(IRREGULAR[s]);
    add(s.replace(/'s$/, ''));
    if (/ies$/.test(s)) add(s.slice(0, -3) + 'y');
    if (/(sses|shes|ches|xes|zes)$/.test(s)) add(s.slice(0, -2));
    if (/s$/.test(s) && !/(ss|us|is)$/.test(s)) add(s.slice(0, -1));
    if (/ied$/.test(s)) add(s.slice(0, -3) + 'y');
    if (/([bdfglmnprt])\1ed$/.test(s)) add(s.slice(0, -3));
    if (/ed$/.test(s)) { add(s.slice(0, -2)); add(s.slice(0, -1)); }
    if (/([bdfglmnprt])\1ing$/.test(s)) add(s.slice(0, -4));
    if (/ing$/.test(s)) { add(s.slice(0, -3)); add(s.slice(0, -3) + 'e'); }
    return Object.keys(out);
  }

  function buildWordMap(seg) {
    var map = {};
    ((seg && seg.words) || []).forEach(function (w) {
      if (!w) return;
      if (w.w) map[String(w.w).toLowerCase()] = w;
      if (w.src) map[String(w.src).toLowerCase()] = w;
    });
    return map;
  }

  function findWord(map, tok) {
    var cands = tokenCandidates(tok);
    for (var i = 0; i < cands.length; i++) {
      if (map[cands[i]]) return map[cands[i]];
    }
    return null;
  }

  function renderSubtitle(seg) {
    if (!App.hasSubtitle) return;
    var enEl = $('subtitle-en');
    var en = (seg && seg.en) || '';
    enEl.textContent = '';
    if (en) {
      var map = buildWordMap(seg);
      var re = /[A-Za-z][A-Za-z']*/g;
      var last = 0, m;
      while ((m = re.exec(en)) !== null) {
        if (m.index > last) enEl.appendChild(document.createTextNode(en.slice(last, m.index)));
        var tok = m[0];
        var word = findWord(map, tok);
        if (word) {
          var span = document.createElement('span');
          span.className = 'sub-word';
          span.textContent = tok;
          span.title = wordLabel(word) + (word.zh ? '：' + word.zh : '');
          span.addEventListener('click', function (ev) {
            ev.stopPropagation();
            selectWord(word);
          });
          enEl.appendChild(span);
        } else {
          enEl.appendChild(document.createTextNode(tok));
        }
        last = re.lastIndex;
      }
      if (last < en.length) enEl.appendChild(document.createTextNode(en.slice(last)));
    }
    $('subtitle-zh').textContent = (seg && seg.zh) || '';
    fitSubtitle();
  }

  function renderPinned() {
    var box = $('pinned-word');
    if (!App.pinned) {
      box.innerHTML = '<span class="pinned-placeholder">點下方詞匯，這裡會顯示中文解釋</span>';
      return;
    }
    box.innerHTML =
      '<span class="pinned-en">' + escapeHtml(wordLabel(App.pinned)) + '</span>' +
      '<span class="pinned-zh">' + escapeHtml(App.pinned.zh || '（尚無中文翻譯）') + '</span>';
  }

  function wordLabel(word) {
    if (!word) return '';
    return (word.src && word.src !== word.w) ? word.src + ' (' + word.w + ')' : word.w;
  }

  function pauseVideo() {
    if (App.ready && App.player) { try { App.player.pause(); } catch (e) { /* ignore */ } }
  }

  function selectWord(word) {
    App.pinned = word;
    renderPinned();
    var chips = document.querySelectorAll('#vocab-list .vocab-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('active', chips[i].dataset.w === word.w);
    }
    pauseVideo();
  }

  /* ---------- 段導覽 ---------- */
  function gotoSegment(i) {
    if (!App.vocab.length) return;
    App.searching = false;
    i = clamp(i, 0, App.vocab.length - 1);
    renderSegment(i);
    var seg = App.vocab[i];
    seekTo(seg.start);
    pauseVideo();
  }

  /* ---------- 詞匯搜尋：列出所有符合的片段，點擊跳到該段 ---------- */
  function searchWord() {
    var q = ($('vocab-search').value || '').trim().toLowerCase();
    if (!q) {
      if (App.vocab.length) renderSegment(App.segIndex >= 0 ? App.segIndex : 0);
      return;
    }
    var matches = [];
    for (var i = 0; i < App.vocab.length; i++) {
      var words = App.vocab[i].words;
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        if ((w.w || '').indexOf(q) !== -1 || (w.src || '').indexOf(q) !== -1) {
          matches.push({ seg: i, word: w });
          break;
        }
      }
    }
    if (!matches.length) {
      showOSD('✕ 找不到「' + q + '」', '#F59E0B', 1500);
      return;
    }
    renderSearchResults(q, matches);
  }

  function renderSearchResults(q, matches) {
    App.searching = true;
    $('seg-label').textContent = '搜尋「' + q + '」：' + matches.length + ' 段';
    var list = $('vocab-list');
    list.innerHTML = '';
    var frag = document.createDocumentFragment();
    matches.forEach(function (m) {
      var seg = App.vocab[m.seg];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-result';
      btn.innerHTML =
        '<span class="sr-word">' + escapeHtml(wordLabel(m.word)) + '</span>' +
        '<span class="sr-time mono">' + formatClock(seg.start) + ' – ' + formatClock(seg.end) + '</span>';
      btn.addEventListener('click', function () {
        $('vocab-search').value = '';
        gotoSegment(m.seg);
      });
      frag.appendChild(btn);
    });
    list.appendChild(frag);
  }

  /* ================= 播放控制 ================= */
  function seekTo(t) {
    if (!App.ready || !App.player) return;
    t = clamp(t, 0, App.duration || t);
    App.pendingSeek = t;
    App.pendingUntil = Date.now() + 2000;
    displayAtTime(t);
    App.player.seek(t);
  }

  /* 立即依指定時間更新字幕與詞匯（不等影片載入完成） */
  function displayAtTime(t) {
    $('txt-now').textContent = formatTime(t);
    updatePlayhead(t);
    if (!App.vocab.length) return;
    var i = segmentIndexAt(t);
    if (i < 0) {
      if (App.segIndex !== -1) clearSegment();
      return;
    }
    if (i !== App.segIndex) renderSegment(i);
  }

  function togglePlay() {
    if (!App.ready || !App.player) return;
    if (App.player.getState() === 'playing') App.player.pause();
    else App.player.play();
  }

  function toggleFullscreen() {
    var el = $('video-wrap');
    if (!el) return;
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }

  function updateFullscreenIcon() {
    var b = $('btn-fullscreen');
    if (!b) return;
    var on = document.fullscreenElement || document.webkitFullscreenElement;
    b.textContent = on ? '⤢' : '⛶';
  }

  function applySpeed() {
    var sel = $('speed-select');
    if (App.player && App.player.supportsRate === false) {
      sel.disabled = true;
      sel.title = '此來源不支援變速';
    } else {
      sel.disabled = false;
      if (App.ready && App.player) { try { App.player.setRate(App.speed); } catch (e) { /* ignore */ } }
    }
    sel.value = String(App.speed);
  }

  /* 依容器高度自動決定字級：先依高度取基準，內容放不下再逐步縮小 */
  function fitSubtitle() {
    var text = $('subtitle-text');
    if (!text) return;
    var en = $('subtitle-en'), zh = $('subtitle-zh');
    var avail = text.clientHeight;
    if (!avail) return;
    var size = clamp(Math.floor(avail / 2.9), SUB_FONT_MIN, SUB_FONT_MAX);
    function apply(s) {
      en.style.fontSize = s + 'px';
      zh.style.fontSize = Math.round(s * 0.85) + 'px';
    }
    apply(size);
    var guard = 0;
    while ((en.scrollHeight + zh.scrollHeight) > avail && size > SUB_FONT_MIN && guard < 80) {
      size -= 1;
      apply(size);
      guard++;
    }
  }

  function applySubtitleHeight() {
    var bar = $('subtitle-bar');
    if (bar) bar.style.setProperty('--sub-height', App.subHeight + 'px');
    fitSubtitle();
  }

  function loadSubHeight() {
    try {
      var v = parseInt(localStorage.getItem(LS_SUBHEIGHT), 10);
      if (isFinite(v)) App.subHeight = clamp(v, SUB_HEIGHT_MIN, SUB_HEIGHT_MAX);
    } catch (e) { /* ignore */ }
  }

  function saveSubHeight() {
    try { localStorage.setItem(LS_SUBHEIGHT, String(App.subHeight)); } catch (e) { /* ignore */ }
  }

  function bindSubtitleResize() {
    var handle = $('subtitle-resize');
    if (!handle) return;
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var startY = e.clientY;
      var startH = App.subHeight;
      handle.classList.add('dragging');
      function onMove(ev) {
        App.subHeight = clamp(startH + (ev.clientY - startY), SUB_HEIGHT_MIN, SUB_HEIGHT_MAX);
        applySubtitleHeight();
      }
      function onUp() {
        handle.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        saveSubHeight();
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  /* ================= 時間軸 UI ================= */
  function updatePlayhead(t) {
    if (!App.duration) return;
    var p = clamp((t / App.duration) * 100, 0, 100);
    $('ab-playhead').style.left = p + '%';
  }

  function updateTimeLabels() {
    $('txt-dur').textContent = formatTime(App.duration);
  }

  function bindTimeline() {
    var wrapper = $('ab-timeline');
    var track = $('ab-track');
    var playhead = $('ab-playhead');
    var scrubbing = false;
    var wasPlaying = false;

    function timeAt(clientX) {
      var rect = track.getBoundingClientRect();
      if (!rect.width) return 0;
      var x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      return (x / rect.width) * App.duration;
    }

    wrapper.addEventListener('pointerdown', function (e) {
      if (!App.ready || !App.player || !App.duration) return;
      e.preventDefault();
      scrubbing = true;
      wasPlaying = (App.player.getState() === 'playing');
      if (wasPlaying) App.player.pause();
      if (playhead) playhead.classList.add('dragging');
      try { wrapper.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      seekTo(timeAt(e.clientX));
    });

    wrapper.addEventListener('pointermove', function (e) {
      if (!scrubbing) return;
      e.preventDefault();
      seekTo(timeAt(e.clientX));
    });

    function endScrub() {
      if (!scrubbing) return;
      scrubbing = false;
      if (playhead) playhead.classList.remove('dragging');
      if (wasPlaying) { try { App.player.play(); } catch (e) { /* ignore */ } }
      wasPlaying = false;
    }
    wrapper.addEventListener('pointerup', endScrub);
    wrapper.addEventListener('pointercancel', endScrub);
  }

  /* ================= UI 事件綁定 ================= */
  function bindUI() {
    $('btn-fullscreen').addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
    $('speed-select').addEventListener('change', function () {
      App.speed = parseFloat(this.value) || 1;
      applySpeed();
      saveState();
    });

    $('btn-prev-seg').addEventListener('click', function () { gotoSegment(App.segIndex - 1); });
    $('btn-next-seg').addEventListener('click', function () { gotoSegment(App.segIndex + 1); });
    $('vocab-search').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); searchWord(); }
    });
    $('vocab-search').addEventListener('input', function () {
      if (this.value.trim() || !App.vocab.length) return;
      var i = App.segIndex >= 0 ? App.segIndex : segmentIndexAt(App.player ? App.player.getCurrentTime() : 0);
      if (i >= 0) renderSegment(i); else clearSegment();
    });
    $('subtitle-text').addEventListener('click', function (e) {
      if (e.target.closest('.sub-word')) return;
      if (!App.ready || !App.player) return;
      if (App.player.getState() === 'playing') pauseVideo();
      else App.player.play();
    });

    bindTimeline();
    bindSubtitleResize();
    bindKeyboard();
    bindFocusRetention();
    window.addEventListener('resize', fitSubtitle);
  }

  /* ================= 快捷鍵（捕獲階段） ================= */
  function isTyping(e) {
    var el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function bindKeyboard() {
    window.addEventListener('keydown', function (e) {
      if (isTyping(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!App.ready) return;

      switch (e.key) {
        case 'a': case 'A':
          e.preventDefault(); gotoSegment(App.segIndex - 1); break;
        case 'd': case 'D':
          e.preventDefault(); gotoSegment(App.segIndex + 1); break;
        case ' ':
          e.preventDefault(); togglePlay(); break;
      }
    }, true);
  }

  /* 焦點保持：點進 iframe 後立刻把焦點拉回頁面，快捷鍵才不會失效 */
  function bindFocusRetention() {
    document.addEventListener('focusout', function (e) {
      var iframe = document.querySelector('#player iframe');
      if (iframe && e.relatedTarget === iframe) {
        window.focus();
      }
    });
  }

  /* ================= 持久化 ================= */
  function lsKey() {
    return LS_PREFIX + (App.id || App.videoId);
  }

  function saveState() {
    try {
      localStorage.setItem(lsKey(), JSON.stringify({
        speed: App.speed
      }));
    } catch (e) { /* ignore */ }
  }

  function restoreState() {
    try {
      var d = JSON.parse(localStorage.getItem(lsKey()));
      if (!d) return false;
      if (SPEEDS.indexOf(d.speed) !== -1) App.speed = d.speed;
      return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /* ================= 工具函式 ================= */
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    var tenth = Math.floor((seconds % 1) * 10);
    return pad(mins) + ':' + pad(secs) + '.' + tenth;
  }

  function formatClock(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return pad(mins) + ':' + pad(secs);
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = String(text == null ? '' : text);
    return div.innerHTML;
  }

  function showOSD(text, color, duration) {
    var el = $('osd');
    el.textContent = text;
    el.style.color = color || '#FFFFFF';
    el.classList.add('active');
    clearTimeout(App.osdTimer);
    App.osdTimer = setTimeout(function () {
      el.classList.remove('active');
    }, duration || 1200);
  }

  /* ================= 啟動 ================= */
  init();
})();
