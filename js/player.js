/* ============================================================
   播放頁主邏輯：播放器生命週期、A-B 循環、字幕渲染、快捷鍵、匯出
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

  var App = {
    program: null,
    videoId: '',
    title: '',
    lang: 'en',
    srtPath: '',
    player: null,
    ready: false,
    duration: 0,
    timeA: 0,
    timeB: 0,
    loopActive: false,
    speed: 1,
    showSubs: true,
    fadeEnabled: true,
    subtitles: [],
    subSource: 'none',
    subNote: '',
    tickTimer: null,
    osdTimer: null,
    lastActiveIdx: -1
  };

  /* ================= 初始化 ================= */
  async function init() {
    if (programId) {
      try {
        var res = await fetch('programs.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        var p = (data.programs || []).find(function (x) { return x.id === programId; });
        if (!p || !p.videoId) throw new Error('找不到節目');
        App.program = p;
        App.videoId = p.videoId;
        App.title = p.title || 'Journey to the West';
        App.lang = p.lang || data.defaultLang || 'en';
        App.srtPath = p.srt || '';
      } catch (err) {
        showFatal('無法載入節目：' + err.message);
        return;
      }
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

    bindUI();
    loadPlayer();
  }

  function showFatal(msg) {
    var el = $('player-error');
    el.textContent = msg;
    el.hidden = false;
    var note = $('sub-note');
    if (note) note.textContent = '';
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

    // 逾時保護：YouTube API 被封鎖時顯示錯誤
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
    App.timeB = App.duration;
    restoreState();
    applySpeed();
    updateTimelineUI();
    updateTimeLabels();
    updatePlayhead(0);
    window.focus();
    document.body.focus();
    loadSubtitles();
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

    $('txt-now').textContent = formatTime(t);
    updatePlayhead(t);

    if (App.loopActive && App.duration && t >= App.timeB) {
      seekTo(App.timeA);
    }
    renderSubtitle(t);
  }

  /* ================= 字幕載入與渲染 ================= */
  async function loadSubtitles() {
    var note = $('sub-note');
    note.textContent = '字幕載入中…';
    note.className = 'sub-note';

    var result = await window.Captions.load(App.videoId, App.lang, App.srtPath);
    result = result || { subtitles: [], source: 'none', note: '字幕載入失敗' };
    App.subtitles = result.subtitles || [];
    App.subSource = result.source;
    App.subNote = result.note || '';
    renderTranscript();
    updateSubNote();
  }

  function updateSubNote() {
    var note = $('sub-note');
    var n = App.subtitles.length;
    if (App.subSource === 'srt') {
      note.textContent = '✓ 字幕來源：老師上傳的 SRT（' + n + ' 行）';
      note.className = 'sub-note ok';
    } else if (App.subSource === 'youtube') {
      note.textContent = '✓ 字幕來源：YouTube 自動抓取（' + n + ' 行，' + App.lang + '）';
      note.className = 'sub-note ok';
    } else {
      note.textContent = '⚠️ ' + App.subNote + '（上傳方式見 README.md）';
      note.className = 'sub-note warn';
    }
  }

  function renderTranscript() {
    var list = $('transcript-list');
    if (!App.subtitles.length) {
      list.innerHTML = '<div class="transcript-empty">目前沒有字幕。' +
        (App.subNote ? '<br>' + escapeHtml(App.subNote) : '') + '</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    App.subtitles.forEach(function (s, i) {
      var btn = document.createElement('button');
      btn.className = 't-line';
      btn.dataset.i = i;
      btn.innerHTML =
        '<span class="t-time">' + formatTime(s.start) + '</span>' +
        '<span class="t-text">' + escapeHtml(s.text).replace(/\n/g, '<br>') + '</span>';
      btn.addEventListener('click', function () {
        loopSentence(App.subtitles[+btn.dataset.i]);
      });
      frag.appendChild(btn);
    });
    list.innerHTML = '';
    list.appendChild(frag);
  }

  function renderSubtitle(t) {
    var overlay = $('subtitle-overlay');
    var active = getActiveLines(t);

    if (!App.showSubs || !active.length) {
      overlay.innerHTML = '';
      overlay.classList.remove('visible');
    } else {
      overlay.innerHTML = active
        .map(function (s) { return '<div class="sub-line">' + escapeHtml(s.text).replace(/\n/g, '<br>') + '</div>'; })
        .join('');
      overlay.classList.add('visible');
    }

    // 面板高亮 + 自動捲動（只在行改變時觸發，避免抖動）
    var idx = active.length ? App.subtitles.indexOf(active[0]) : -1;
    if (idx !== App.lastActiveIdx) {
      App.lastActiveIdx = idx;
      var lines = document.querySelectorAll('#transcript-list .t-line');
      for (var i = 0; i < lines.length; i++) {
        lines[i].classList.toggle('active', i === idx);
      }
      if (idx >= 0 && lines[idx]) {
        lines[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function getActiveLines(t) {
    if (!App.subtitles.length) return [];
    return App.subtitles.filter(function (s) {
      return t >= s.start - 0.05 && t <= s.end + 0.05;
    });
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

  function loopSentence(line) {
    App.timeA = Math.max(0, line.start - 0.15);
    App.timeB = Math.min(App.duration, line.end + 0.15);
    App.loopActive = true;
    setLoopUI(true);
    seekTo(App.timeA);
    showOSD('單句循環', '#2563EB', 1200);
    updateTimelineUI();
    updateTimeLabels();
    saveState();
  }

  function jumpSentence(dir) {
    if (!App.subtitles.length) {
      showOSD('⚠️ 無字幕數據', '#F59E0B', 1200);
      return;
    }
    var t = App.player.getCurrentTime();
    var target = null;
    if (dir < 0) {
      var prev = App.subtitles.filter(function (s) { return s.end < t - 0.05; });
      target = prev.length ? prev[prev.length - 1] : App.subtitles[0];
    } else {
      var next = App.subtitles.filter(function (s) { return s.start > t + 0.05; });
      target = next.length ? next[0] : App.subtitles[App.subtitles.length - 1];
    }
    if (App.loopActive) {
      loopSentence(target);
    } else {
      seekTo(target.start);
      showOSD(dir < 0 ? '◀ 上一句' : '下一句 ▶', '#FFFFFF', 800);
    }
  }

  /* ================= 播放控制 ================= */
  function seekTo(t) {
    if (!App.ready) return;
    t = clamp(t, 0, App.duration || t);
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

    // 點時間軸＝跳轉播放位置
    wrapper.addEventListener('click', function (e) {
      if (e.target.closest('.ab-handle')) return;
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
    $('btn-prev-sub').addEventListener('click', function () { jumpSentence(-1); });
    $('btn-next-sub').addEventListener('click', function () { jumpSentence(1); });
    $('btn-cc').addEventListener('click', toggleCC);
    $('speed-select').addEventListener('change', function () {
      App.speed = parseFloat(this.value) || 1;
      applySpeed();
      saveState();
    });
    $('btn-copy').addEventListener('click', onCopyCard);
    $('btn-csv').addEventListener('click', onDownloadCSV);

    bindTimeline();
    bindKeyboard();
    bindFocusRetention();
  }

  function toggleCC() {
    App.showSubs = !App.showSubs;
    $('btn-cc').classList.toggle('on', App.showSubs);
    showOSD(App.showSubs ? '字幕：開' : '字幕：關', '#FFFFFF', 900);
    saveState();
  }

  /* ================= 匯出 ================= */
  function onCopyCard() {
    if (!App.ready) return;
    var card = window.AnkiExport.buildCard({
      subtitles: App.subtitles,
      timeA: App.timeA,
      timeB: App.timeB,
      title: App.title,
      videoId: App.videoId,
      formatTime: formatTime
    });
    window.AnkiExport.copyCard(card).then(function (ok) {
      showOSD(ok ? '✓ 已複製卡片' : '✕ 複製失敗', ok ? '#34C759' : '#F59E0B', ok ? 1200 : 2000);
    });
  }

  function onDownloadCSV() {
    if (!App.ready) return;
    var card = window.AnkiExport.buildCard({
      subtitles: App.subtitles,
      timeA: App.timeA,
      timeB: App.timeB,
      title: App.title,
      videoId: App.videoId,
      formatTime: formatTime
    });
    window.AnkiExport.downloadCSV(card, App.videoId);
    showOSD('✓ 已下載 CSV（可匯入 Anki）', '#34C759', 1500);
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
          if (App.loopActive) { e.preventDefault(); jumpSentence(-1); }
          break;
        case 'd': case 'D':
          if (App.loopActive) { e.preventDefault(); jumpSentence(1); }
          break;
        case 'c': case 'C':
          e.preventDefault(); toggleCC(); break;
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
        showSubs: App.showSubs
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
      if (typeof d.showSubs === 'boolean') App.showSubs = d.showSubs;
      setLoopUI(App.loopActive);
      $('btn-cc').classList.toggle('on', App.showSubs);
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
