/* ============================================================
   播放頁主邏輯：播放器生命週期、A-B 循環、詞匯面板、快捷鍵、匯出
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var params = new URLSearchParams(location.search);
  var programId = params.get('id');
  var directV = params.get('v');

  var MIN_GAP = 0.2;          // A-B 最小間隔（秒）
  var TICK_MS = 250;          // 時間輪詢週期
  var SPEEDS = [0.5, 0.75, 0.85, 1.0, 1.25];
  var LS_PREFIX = 'utube_web_v1:';
  var SUB_FONT_MIN = 14;
  var SUB_FONT_MAX = 34;
  var SUB_FONT_STEP = 2;
  var SUB_FONT_DEFAULT = 20;
  var LS_SUBFONT = LS_PREFIX + 'subfont';
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
    abDefaultPending: false,
    duration: 0,
    timeA: 0,
    timeB: 0,
    loopActive: false,
    speed: 1,
    fadeEnabled: true,
    vocab: [],            // [ { start, end, words: [ { w, zh } ] } ]
    vocabSource: 'none',  // json | none
    segIndex: -1,
    follow: true,
    pinned: null,
    offset: 0,
    subFontSize: SUB_FONT_DEFAULT,
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
    loadSubFont();
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

  function onPlayerReady() {
    if (App.ready) return;
    App.ready = true;
    App.duration = App.player.getDuration() || 0;
    App.timeA = 0;
    App.timeB = App.duration ? Math.min(10, App.duration) : 10;
    var hadSaved = restoreState();
    if (!hadSaved && !App.duration) App.abDefaultPending = true;
    setLoopUI(App.loopActive);
    applySpeed();
    applySubtitleHeight();
    updateTimelineUI();
    updateTimeLabels();
    updatePlayhead(0);
    window.focus();
    document.body.focus();
    loadVocabulary();
    App.tickTimer = setInterval(tick, TICK_MS);
  }

  function onPlayerStateChange(state) {
    if (state === 'ended' && App.loopActive && App.duration) seekTo(App.timeA);
  }

  function onPlayerError() {
    showOSD('✕ 影片無法播放（可能受地區或年齡限制，或連結不允許嵌入）', '#F59E0B', 2600);
  }

  /* ================= 時間輪詢 ================= */
  function syncDuration() {
    if (!App.player) return;
    var d = App.player.getDuration() || 0;
    if (d <= 0 || Math.abs(d - App.duration) < 0.5) return;
    App.duration = d;
    if (App.abDefaultPending) {
      App.abDefaultPending = false;
      App.timeA = 0;
      App.timeB = Math.min(10, d);
    } else if (App.timeB > d) {
      App.timeB = d;
    }
    updateTimelineUI();
    updateTimeLabels();
  }

  function tick() {
    if (!App.ready || !App.player) return;
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

    if (App.loopActive && App.duration && t >= App.timeB) {
      seekTo(App.timeA);
    }
    if (App.follow) updateSegment(t);
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
    renderSegment(segmentIndexAt(t - App.offset));
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
    if (!App.follow || !App.vocab.length) return;
    var i = segmentIndexAt(t - App.offset);
    if (i !== App.segIndex && i >= 0) renderSegment(i);
  }

  /* ---------- 渲染目前段落 ---------- */
  function renderSegment(i) {
    if (!App.vocab.length) return;
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
    i = clamp(i, 0, App.vocab.length - 1);
    renderSegment(i);
    var seg = App.vocab[i];
    seekTo(seg.start + App.offset);
    pauseVideo();
  }

  /* ---------- 詞匯搜尋（Enter 跳到含該詞的段） ---------- */
  function searchWord() {
    var q = ($('vocab-search').value || '').trim().toLowerCase();
    if (!q) return;
    for (var i = 0; i < App.vocab.length; i++) {
      var words = App.vocab[i].words;
      for (var j = 0; j < words.length; j++) {
        if (words[j].w.indexOf(q) !== -1 || (words[j].src || '').indexOf(q) !== -1) {
          gotoSegment(i);
          showOSD('找到「' + wordLabel(words[j]) + '」於 ' + formatClock(App.vocab[i].start), '#2563EB', 1500);
          return;
        }
      }
    }
    showOSD('✕ 找不到「' + q + '」', '#F59E0B', 1500);
  }

  /* ================= A-B 循環核心 ================= */
  function toggleLoop() {
    App.loopActive = !App.loopActive;
    setLoopUI(App.loopActive);
    showOSD(App.loopActive ? 'Loop Mode: ON' : 'Loop Mode: OFF',
      App.loopActive ? '#2563EB' : '#A3A3A3', 1000);
    if (App.loopActive && App.ready) {
      var t = App.player.getCurrentTime();
      if (t < App.timeA || t > App.timeB) seekTo(App.timeA);
    }
    saveState();
  }

  function setLoopUI(on) {
    var pill = $('btn-loop');
    pill.classList.toggle('on', on);
    $('loop-text').textContent = on ? 'Looping' : 'A-B Off';
  }

  function setA() {
    if (!App.ready) return;
    App.timeA = clamp(App.player.getCurrentTime(), 0, Math.max(0, App.timeB - MIN_GAP));
    updateTimelineUI();
    updateTimeLabels();
    showOSD('[ A 點已設定 ]', '#FFFFFF', 800);
    saveState();
  }

  function setB() {
    if (!App.ready) return;
    App.timeB = clamp(App.player.getCurrentTime(), Math.min(App.duration, App.timeA + MIN_GAP), App.duration);
    updateTimelineUI();
    updateTimeLabels();
    showOSD('[ B 點已設定 ]', '#FFFFFF', 800);
    saveState();
  }

  function replayFromA() {
    if (!App.ready) return;
    seekTo(App.timeA);
    try { App.player.play(); } catch (e) { /* ignore */ }
    showOSD('▶ 從 A 點重播', '#F59E0B', 900);
  }

  function nudgeA(delta) {
    App.timeA = clamp(App.timeA + delta, 0, Math.max(0, App.timeB - MIN_GAP));
    updateTimelineUI();
    updateTimeLabels();
    saveState();
  }

  function nudgeB(delta) {
    App.timeB = clamp(App.timeB + delta, Math.min(App.duration, App.timeA + MIN_GAP), App.duration);
    updateTimelineUI();
    updateTimeLabels();
    saveState();
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
    var i = segmentIndexAt(t - App.offset);
    if (i >= 0 && i !== App.segIndex) renderSegment(i);
  }

  function togglePlay() {
    if (!App.ready || !App.player) return;
    if (App.player.getState() === 'playing') App.player.pause();
    else App.player.play();
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

  function changeSubtitleFont(delta) {
    App.subFontSize = clamp(App.subFontSize + delta, SUB_FONT_MIN, SUB_FONT_MAX);
    fitSubtitle();
    saveSubFont();
  }

  /* 依容器高度自動縮字：內容放不下就縮小字級，避免溢出與版面跳動 */
  function fitSubtitle() {
    var text = $('subtitle-text');
    if (!text) return;
    var en = $('subtitle-en'), zh = $('subtitle-zh');
    var avail = text.clientHeight;
    if (!avail) return;
    var size = App.subFontSize;
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

  function loadSubFont() {
    try {
      var v = parseInt(localStorage.getItem(LS_SUBFONT), 10);
      if (isFinite(v)) App.subFontSize = clamp(v, SUB_FONT_MIN, SUB_FONT_MAX);
    } catch (e) { /* ignore */ }
  }

  function saveSubFont() {
    try { localStorage.setItem(LS_SUBFONT, String(App.subFontSize)); } catch (e) { /* ignore */ }
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
    handle.addEventListener('mousedown', function (e) {
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
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        saveSubHeight();
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  /* ================= 時間軸 UI ================= */
  function pct(t) {
    return App.duration ? (t / App.duration) * 100 : 0;
  }

  function updateTimelineUI() {
    var pa = pct(App.timeA);
    var pb = pct(App.timeB);
    $('ab-range').style.left = pa + '%';
    $('ab-range').style.width = Math.max(0, pb - pa) + '%';
    $('ab-handle-a').style.left = pa + '%';
    $('ab-handle-b').style.left = pb + '%';
  }

  function updatePlayhead(t) {
    if (!App.duration) return;
    var p = clamp((t / App.duration) * 100, 0, 100);
    $('ab-playhead').style.left = p + '%';
  }

  function updateTimeLabels() {
    $('txt-a').textContent = formatTime(App.timeA);
    $('txt-b').textContent = formatTime(App.timeB);
    $('txt-dur').textContent = formatTime(App.duration);
  }

  function bindTimeline() {
    var wrapper = $('ab-timeline');
    var track = $('ab-track');

    function makeDrag(which) {
      return function (e) {
        e.preventDefault();
        var rect = track.getBoundingClientRect();
        var handle = which === 'A' ? $('ab-handle-a') : $('ab-handle-b');
        handle.classList.add('dragging');

        function onMove(ev) {
          var offsetX = ev.clientX - rect.left;
          offsetX = Math.max(0, Math.min(offsetX, rect.width));
          var t = (offsetX / rect.width) * App.duration;
          window.requestAnimationFrame(function () {
            if (which === 'A') {
              App.timeA = clamp(t, 0, Math.max(0, App.timeB - MIN_GAP));
            } else {
              App.timeB = clamp(t, Math.min(App.duration, App.timeA + MIN_GAP), App.duration);
            }
            updateTimelineUI();
            updateTimeLabels();
            seekTo(which === 'A' ? App.timeA : App.timeB);
          });
        }
        function onUp() {
          handle.classList.remove('dragging');
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          saveState();
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      };
    }

    $('ab-handle-a').addEventListener('mousedown', makeDrag('A'));
    $('ab-handle-b').addEventListener('mousedown', makeDrag('B'));

    // 拖曳藍色 A-B 區段：整段平移，畫面跟隨 A 點
    var range = $('ab-range');
    range.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var rect = track.getBoundingClientRect();
      var startX = e.clientX;
      var a0 = App.timeA;
      var span = Math.max(MIN_GAP, App.timeB - App.timeA);
      var maxA = Math.max(0, (App.duration || 0) - span);
      var moved = false;
      range.classList.add('dragging');

      function onMove(ev) {
        if (Math.abs(ev.clientX - startX) > 2) moved = true;
        var delta = ((ev.clientX - startX) / rect.width) * App.duration;
        window.requestAnimationFrame(function () {
          App.timeA = clamp(a0 + delta, 0, maxA);
          App.timeB = Math.min(App.duration || (App.timeA + span), App.timeA + span);
          updateTimelineUI();
          updateTimeLabels();
          seekTo(App.timeA);
        });
      }
      function onUp(ev) {
        range.classList.remove('dragging');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (!moved) {
          var x = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
          seekTo((x / rect.width) * App.duration);
        }
        saveState();
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    wrapper.addEventListener('click', function (e) {
      if (e.target.closest('.ab-handle') || e.target.closest('.ab-range')) return;
      var rect = track.getBoundingClientRect();
      var offsetX = e.clientX - rect.left;
      offsetX = Math.max(0, Math.min(offsetX, rect.width));
      seekTo((offsetX / rect.width) * App.duration);
    });
  }

  /* ================= UI 事件綁定 ================= */
  function bindUI() {
    $('btn-loop').addEventListener('click', toggleLoop);
    $('txt-a').addEventListener('click', replayFromA);
    $('txt-b').addEventListener('click', setB);
    $('btn-nudge-a').addEventListener('click', function () { nudgeA(-1); });
    $('btn-nudge-b').addEventListener('click', function () { nudgeB(1); });
    $('speed-select').addEventListener('change', function () {
      App.speed = parseFloat(this.value) || 1;
      applySpeed();
      saveState();
    });

    $('btn-prev-seg').addEventListener('click', function () { gotoSegment(App.segIndex - 1); });
    $('btn-next-seg').addEventListener('click', function () { gotoSegment(App.segIndex + 1); });
    $('btn-follow').addEventListener('click', function () {
      App.follow = !App.follow;
      this.classList.toggle('on', App.follow);
      showOSD(App.follow ? '自動跟隨：開' : '自動跟隨：關（已鎖定）', '#FFFFFF', 900);
      if (App.follow && App.ready) updateSegment(App.player.getCurrentTime());
      saveState();
    });
    $('vocab-search').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); searchWord(); }
    });
    $('sub-offset').addEventListener('input', function () {
      App.offset = parseFloat(this.value) || 0;
      if (App.ready) renderSegment(segmentIndexAt(App.player.getCurrentTime() - App.offset));
      saveState();
    });
    $('btn-sub-smaller').addEventListener('click', function () { changeSubtitleFont(-SUB_FONT_STEP); });
    $('btn-sub-larger').addEventListener('click', function () { changeSubtitleFont(SUB_FONT_STEP); });
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
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        toggleLoop();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!App.ready) return;

      switch (e.key) {
        case '[':
          e.preventDefault(); setA(); break;
        case ']':
          e.preventDefault(); setB(); break;
        case 'ArrowLeft':
          if (App.loopActive) { e.preventDefault(); nudgeA(-1); }
          break;
        case 'ArrowRight':
          if (App.loopActive) { e.preventDefault(); nudgeB(1); }
          break;
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
        timeA: App.timeA,
        timeB: App.timeB,
        loopActive: App.loopActive,
        speed: App.speed,
        offset: App.offset,
        follow: App.follow
      }));
    } catch (e) { /* ignore */ }
  }

  function restoreState() {
    try {
      var d = JSON.parse(localStorage.getItem(lsKey()));
      if (!d) return false;
      if (isFinite(d.timeA)) App.timeA = clamp(d.timeA, 0, App.duration);
      if (isFinite(d.timeB)) App.timeB = clamp(d.timeB, Math.min(App.duration, App.timeA + MIN_GAP), App.duration);
      else App.timeB = App.duration;
      if (SPEEDS.indexOf(d.speed) !== -1) App.speed = d.speed;
      if (typeof d.loopActive === 'boolean') App.loopActive = d.loopActive;
      if (isFinite(d.offset)) App.offset = d.offset;
      if (typeof d.follow === 'boolean') App.follow = d.follow;
      setLoopUI(App.loopActive);
      $('sub-offset').value = App.offset;
      $('btn-follow').classList.toggle('on', App.follow);
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
