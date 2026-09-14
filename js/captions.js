/* ============================================================
   字幕引擎：雙軌載入（老師 SRT 優先 → Cloudflare Function 自動抓取）
   輸出格式：[{ start: 秒, end: 秒, text: string }]
   ============================================================ */
window.Captions = (function () {
  'use strict';

  /* ---------- SRT 解析 ---------- */
  function parseSrt(text) {
    if (!text) return [];
    const normalized = String(text).replace(/\r/g, '').replace(/^\uFEFF/, '');
    const blocks = normalized.split(/\n\s*\n/);
    const subs = [];

    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      const timeIdx = lines.findIndex((l) => l.includes('-->'));
      if (timeIdx === -1) continue;

      const m = lines[timeIdx].match(
        /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
      );
      if (!m) continue;

      const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
      const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
      const text = lines.slice(timeIdx + 1).join('\n').trim();
      if (text && end > start) subs.push({ start, end, text });
    }
    return subs;
  }

  /* ---------- 單一 SRT 檔嘗試 ---------- */
  async function trySrt(path) {
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) return null;
      const text = await res.text();
      const subs = parseSrt(text);
      return subs.length ? subs : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------- 自動抓取（Cloudflare Function） ---------- */
  async function tryFunction(videoId, lang) {
    const unavailable = { subtitles: [], source: 'none', note: '自動字幕服務不可用（部署 Function 後即可自動抓取）' };
    try {
      const res = await fetch('api/captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, lang: lang || 'en' })
      });
      if (!res.ok) return unavailable;
      const data = await res.json();
      if (!data) return unavailable;
      if (data.ok && Array.isArray(data.subtitles) && data.subtitles.length) {
        return { subtitles: data.subtitles, source: 'youtube', note: '' };
      }
      // 有軌但下載失敗 / 無軌
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      const trackStr = tracks.map((t) => t.languageCode + (t.kind === 'asr' ? '（自動）' : '')).join(', ');
      const note = trackStr
        ? 'YouTube 有字幕軌（' + trackStr + '），但自動下載被 YouTube 限制；老師可上傳 SRT 覆蓋'
        : '此影片目前沒有可用的字幕軌；老師可上傳 SRT';
      return { subtitles: [], source: 'none', note };
    } catch (e) {
      return unavailable;
    }
  }

  /* ---------- 主入口：雙軌載入 ---------- */
  async function load(videoId, lang, srtPath) {
    // 第一軌：老師上傳的 SRT（指定路徑或預設 subtitles/{videoId}.srt）
    const srtCandidates = srtPath ? [srtPath] : ['subtitles/' + videoId + '.srt'];
    for (const path of srtCandidates) {
      const subs = await trySrt(path);
      if (subs) return { subtitles: subs, source: 'srt', note: '' };
    }
    // 第二軌：Cloudflare Function 自動抓取
    return tryFunction(videoId, lang);
  }

  return { load, parseSrt };
})();
