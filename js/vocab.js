/* ============================================================
   詞匯引擎（播放頁）
   - 唯一來源：api/vocab/{videoId}（Cloudflare KV，由老師在首頁上載 JSON 寫入）
   - 找不到時回傳空清單
   輸出：{ window, segments: [ { start, end, words: [ { w, zh } ] } ] }
   ============================================================ */
window.Vocab = (function () {
  'use strict';

  /* ---------- 正規化 JSON 內容 ---------- */
  function normalize(data) {
    if (!data || !Array.isArray(data.segments)) return null;
    var segments = data.segments.map(function (seg) {
      var words = (seg.words || []).map(function (it) {
        if (typeof it === 'string') return { w: it, src: it, zh: '' };
        var w = it.w || it.word || '';
        return { w: w, src: it.src || w, zh: it.zh || '' };
      }).filter(function (it) { return it.w; });
      return {
        start: +seg.start || 0,
        end: +seg.end || 0,
        en: seg.en || seg.englishSentence || '',
        zh: seg.zh || seg.chineseTranslation || '',
        words: words
      };
    }).filter(function (seg) { return seg.end > seg.start; });
    if (!segments.length) return null;
    return { window: +data.window || 10, segments: segments };
  }

  /* ---------- 主入口：只讀 KV（api/vocab/{videoId}） ---------- */
  async function load(videoId) {
    var data = null;
    try {
      var res = await fetch('api/vocab/' + encodeURIComponent(videoId), { cache: 'no-cache' });
      if (res.ok) data = await res.json();
    } catch (e) {
      data = null;
    }
    var fromJson = normalize(data);
    if (fromJson) return { source: 'json', window: fromJson.window, segments: fromJson.segments };
    return { source: 'none', window: 10, segments: [] };
  }

  return {
    normalize: normalize,
    load: load
  };
})();
