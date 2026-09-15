/* ============================================================
   播放器轉接層：把不同來源統一成同一介面
   介面：{ supportsRate, getCurrentTime(), getDuration(), getState(),
           play(), pause(), seek(t), setRate(r), destroy() }
   state：'unstarted' | 'playing' | 'paused' | 'buffering' | 'ended'
   來源：youtube | html5(file) | tiktok
   ============================================================ */
window.Players = (function () {
  'use strict';

  /* ---------------- YouTube IFrame API ---------------- */
  function ytState(s) {
    if (typeof YT === 'undefined') return 'unstarted';
    if (s === YT.PlayerState.PLAYING) return 'playing';
    if (s === YT.PlayerState.PAUSED) return 'paused';
    if (s === YT.PlayerState.ENDED) return 'ended';
    if (s === YT.PlayerState.BUFFERING) return 'buffering';
    return 'unstarted';
  }

  function createYouTube(opts) {
    var holder = document.createElement('div');
    opts.container.appendChild(holder);
    var player = new YT.Player(holder, {
      videoId: opts.videoId,
      playerVars: {
        autoplay: 0, rel: 0, modestbranding: 1, playsinline: 1, controls: 1, hl: opts.lang || 'en'
      },
      events: {
        onReady: function () { if (opts.onReady) opts.onReady(); },
        onStateChange: function (e) { if (opts.onStateChange) opts.onStateChange(ytState(e.data)); },
        onError: function (e) { if (opts.onError) opts.onError(e.data); }
      }
    });
    return {
      supportsRate: true,
      getCurrentTime: function () { try { return player.getCurrentTime() || 0; } catch (e) { return 0; } },
      getDuration: function () { try { return player.getDuration() || 0; } catch (e) { return 0; } },
      getState: function () { try { return ytState(player.getPlayerState()); } catch (e) { return 'unstarted'; } },
      play: function () { try { player.playVideo(); } catch (e) { /* ignore */ } },
      pause: function () { try { player.pauseVideo(); } catch (e) { /* ignore */ } },
      seek: function (t) {
        try { player.setVolume(0); } catch (e) { /* ignore */ }
        try { player.seekTo(t, true); } catch (e) { /* ignore */ }
        setTimeout(function () { try { player.setVolume(100); } catch (e) { /* ignore */ } }, 60);
      },
      setRate: function (r) { try { player.setPlaybackRate(r); } catch (e) { /* ignore */ } },
      destroy: function () { try { player.destroy(); } catch (e) { /* ignore */ } }
    };
  }

  /* ---------------- HTML5 <video> / <audio> ---------------- */
  function createHtml5(opts) {
    var isAudio = opts.mediaType === 'audio';
    var el = document.createElement(isAudio ? 'audio' : 'video');
    el.className = isAudio ? 'media-audio' : 'media-video';
    el.src = opts.src;
    el.controls = true;
    el.preload = 'metadata';
    if (!isAudio) { el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', ''); }
    el.addEventListener('loadedmetadata', function () { if (opts.onReady) opts.onReady(); });
    el.addEventListener('play', function () { if (opts.onStateChange) opts.onStateChange('playing'); });
    el.addEventListener('pause', function () { if (opts.onStateChange) opts.onStateChange('paused'); });
    el.addEventListener('ended', function () { if (opts.onStateChange) opts.onStateChange('ended'); });
    el.addEventListener('error', function () { if (opts.onError) opts.onError(el.error && el.error.code); });
    opts.container.appendChild(el);
    return {
      supportsRate: true,
      getCurrentTime: function () { return el.currentTime || 0; },
      getDuration: function () { return isFinite(el.duration) ? el.duration : 0; },
      getState: function () {
        if (el.ended) return 'ended';
        return el.paused ? 'paused' : 'playing';
      },
      play: function () { var p = el.play(); if (p && p.catch) p.catch(function () { /* autoplay 被擋 */ }); },
      pause: function () { try { el.pause(); } catch (e) { /* ignore */ } },
      seek: function (t) { try { el.currentTime = t; } catch (e) { /* ignore */ } },
      setRate: function (r) { try { el.playbackRate = r; } catch (e) { /* ignore */ } },
      destroy: function () {
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) { /* ignore */ }
      }
    };
  }

  /* ---------------- TikTok Embed Player（postMessage） ---------------- */
  function createTikTok(opts) {
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.tiktok.com/player/v1/' + encodeURIComponent(opts.postId) +
      '?autoplay=0&loop=0&rel=0&native_context_menu=0';
    iframe.setAttribute('allow', 'fullscreen; encrypted-media; picture-in-picture');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('title', 'TikTok player');
    opts.container.appendChild(iframe);

    var current = 0, duration = 0, state = 'unstarted';

    function onMsg(e) {
      var d = e.data;
      if (!d || d['x-tiktok-player'] !== true) return;
      if (iframe.contentWindow && e.source && e.source !== iframe.contentWindow) return;
      var t = d.type;
      if (t === 'onPlayerReady') {
        if (opts.onReady) opts.onReady();
      } else if (t === 'onStateChange') {
        var v = d.value;
        state = v === 1 ? 'playing' : v === 2 ? 'paused' : v === 0 ? 'ended' : v === 3 ? 'buffering' : 'unstarted';
        if (opts.onStateChange) opts.onStateChange(state);
      } else if (t === 'onCurrentTime') {
        var val = d.value;
        if (val && typeof val === 'object') {
          if (typeof val.currentTime === 'number') current = val.currentTime;
          if (typeof val.duration === 'number' && val.duration > 0) duration = val.duration;
        } else if (typeof val === 'number') {
          current = val;
        }
      } else if (t === 'onPlayerError' || t === 'onError') {
        if (opts.onError) opts.onError(d.value);
      }
    }
    window.addEventListener('message', onMsg);

    function post(type, value) {
      try {
        iframe.contentWindow.postMessage({ type: type, value: value, 'x-tiktok-player': true }, '*');
      } catch (e) { /* ignore */ }
    }

    return {
      supportsRate: false,
      getCurrentTime: function () { return current; },
      getDuration: function () { return duration; },
      getState: function () { return state; },
      play: function () { post('play'); },
      pause: function () { post('pause'); },
      seek: function (t) { post('seekTo', t); },
      setRate: function () { /* TikTok 不支援變速 */ },
      destroy: function () { window.removeEventListener('message', onMsg); try { iframe.remove(); } catch (e) { /* ignore */ } }
    };
  }

  return {
    createYouTube: createYouTube,
    createHtml5: createHtml5,
    createTikTok: createTikTok
  };
})();
