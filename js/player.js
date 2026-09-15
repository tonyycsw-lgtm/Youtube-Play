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

  var App = {
    program: null,
    videoId: '',
    title: '',
    lang: 'en',
    player: null,
    ready: false,
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
      if (!p || !p.videoId) { showFatal('找不到節目'); return; }
      App.program = p;
      App.videoId = p.videoId;
      App.title = p.title || 'Journey to the West';
      App.lang = p.lang || found.defaultLang || 'en';
    } else if (directV) {
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
    loadSubFont();
    bindUI();
    loadPlayer();
  }

  function showFatal(msg) {
    var el = $('player-error');
    el.textContent = msg;
    el.hidden = false;
  }

  /* ================= 播放器載入 ================= */
  function loadPlayer() {
    if (window.YT && window.YT.Player) {
      createPlayer();
      return;
    }
    window.onYouTubeIframeAPIReady = createPlayer;
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    var first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(tag, first);

    setTimeout(function () {
      if (!App.ready && !window.YT) {
        showFatal('無法載入 YouTube 播放器。請檢查網路，或學校網路是否封鎖 youtube.com / youtube-nocookie.com。');
      }
    }, 9000);
  }

  function createPlayer() {
    try {
      App.player = new YT.Player('player', {
        videoId: App.videoId,
        playerVars: {
          autoplay: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          controls: 1,
          hl: App.lang
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange,
          onError: onPlayerError
        }
      });
    } catch (e) {
      showFatal('播放器初始化失敗：' + e.message);
    }
  }

  function onPlayerReady() {
    App.ready = true;
    App.duration = App.player.getDuration() || 0;
    App.timeA = 0;
    App.timeB = App.duration ? Math.min(10, App.duration) : 0;
    App.loopActive = true;
    restoreState();
    setLoopUI(App.loopActive);
    applySpeed();
    applySubtitleFont();
    updateTimelineUI();
    updateTimeLabels();
    updatePlayhead(0);
    window.focus();
    document.body.focus();
    loadVocabulary();
    App.tickTimer = setInterval(tick, TICK_MS);
  }

  function onPlayerStateChange(e) {
    if (e && e.data === YT.PlayerState.ENDED && App.loopActive && App.duration) {
      seekTo(App.timeA);
    }
  }

  function onPlayerError() {
    showOSD('✕ 影片無法播放（可能受地區或年齡限制）', '#F59E0B', 2600);
  }

  /* ================= 時間輪詢 ================= */
  function tick() {
    if (!App.ready || !App.player) return;
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

  /* ================= 詞匯載入（唯一來源：KV / api/vocab/{videoId}） ================= */
  async function loadVocabulary() {
    var res = await window.Vocab.load(App.videoId);
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
    if (st < segs[0].start) return 0;
    for (var i = 0; i < segs.length; i++) {
      if (st >= segs[i].start - 0.001 && st < segs[i].end) return i;
    }
    return segs.length - 1;
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

  function renderSubtitle(seg) {
    if (!App.hasSubtitle) return;
    $('subtitle-en').textContent = (seg && seg.en) || '';
    $('subtitle-zh').textContent = (seg && seg.zh) || '';
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
    if (App.ready) { try { App.player.pauseVideo(); } catch (e) { /* ignore */ } }
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
    if (!App.ready) return;
    t = clamp(t, 0, App.duration || t);
    App.pendingSeek = t;
    App.pendingUntil = Date.now() + 2000;
    displayAtTime(t);
    if (App.fadeEnabled) {
      try { App.player.setVolume(0); } catch (e) { /* ignore */ }
      App.player.seekTo(t, true);
      setTimeout(function () {
        try { App.player.setVolume(100); } catch (e) { /* ignore */ }
      }, 60);
    } else {
      App.player.seekTo(t, true);
    }
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
    if (!App.ready) return;
    var st = App.player.getPlayerState();
    if (st === 1) App.player.pauseVideo();
    else App.player.playVideo();
  }

  function applySpeed() {
    if (App.ready) {
      try { App.player.setPlaybackRate(App.speed); } catch (e) { /* ignore */ }
    }
    $('speed-select').value = String(App.speed);
  }

  function applySubtitleFont() {
    var bar = $('subtitle-bar');
    if (bar) bar.style.setProperty('--sub-font', App.subFontSize + 'px');
  }

  function changeSubtitleFont(delta) {
    App.subFontSize = clamp(App.subFontSize + delta, SUB_FONT_MIN, SUB_FONT_MAX);
    applySubtitleFont();
    saveSubFont();
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
    $('txt-a').addEventListener('click', setA);
    $('txt-b').addEventListener('click', setB);
    $('btn-nudge-a').addEventListener('click', function () { nudgeA(-0.1); });
    $('btn-nudge-b').addEventListener('click', function () { nudgeB(0.1); });
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

    bindTimeline();
    bindKeyboard();
    bindFocusRetention();
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
          if (App.loopActive) { e.preventDefault(); nudgeA(-0.1); }
          break;
        case 'ArrowRight':
          if (App.loopActive) { e.preventDefault(); nudgeB(0.1); }
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
    return LS_PREFIX + App.videoId;
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
      if (!d) return;
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
    } catch (e) { /* ignore */ }
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
