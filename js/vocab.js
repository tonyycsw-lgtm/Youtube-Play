/* ============================================================
   詞匯引擎（播放頁與 srt-tool 共用）
   - 句群切段：把連續字幕句合併到「至少 window 秒」為一段
   - 斷詞：轉小寫、去標點/數字、去停用詞、段內去重、基本詞形合併
   - 載入 vocabulary/{videoId}.json；找不到時以前端抽取英文詞回退
   輸出：{ window, segments: [ { start, end, words: [ { w, zh } ] } ] }
   ============================================================ */
window.Vocab = (function () {
  'use strict';

  /* ---------- 英文停用詞（功能詞，不列入詞匯） ---------- */
  var STOPWORDS = {};
  ('a about above after again against all am an and any are arent as at be because been before being below ' +
   'between both but by cant cannot could couldnt did didnt do does doesnt doing dont down during each few for ' +
   'from further had hadnt has hasnt have havent having he hed hell hes her here heres hers herself him himself ' +
   'his how hows i id ill im ive if in into is isnt it its itself just lets me more most mustnt my myself no nor ' +
   'not now of off on once only or other ought our ours ourselves out over own same shant she shes should ' +
   'shouldnt so some such than that thats the their theirs them themselves then there theres these they theyd ' +
   'theyll theyre theyve this those through to too under until up very was wasnt we wed well were werent weve ' +
   'what whats when whens where wheres which while who whos whom why whys with wont would wouldnt you youd youll ' +
   'youre youve your yours yourself yourselves also one two three four five six seven eight nine ten mr mrs ms ' +
   'ok okay oh ah ha hey yeah yes well gonna gotta wanna us can may might must shall will').split(/\s+/).forEach(function (w) {
    if (w) STOPWORDS[w] = true;
  });

  /* ---------- 不規則動詞/名詞還原（小型表） ---------- */
  var IRREGULAR = {
    went: 'go', gone: 'go', goes: 'go', going: 'go',
    said: 'say', says: 'say', saying: 'say',
    saw: 'see', seen: 'see', sees: 'see',
    made: 'make', makes: 'make', making: 'make',
    took: 'take', taken: 'take', takes: 'take',
    came: 'come', comes: 'come',
    got: 'get', gotten: 'get', gets: 'get',
    gave: 'give', given: 'give', gives: 'give',
    stood: 'stand', stands: 'stand',
    sat: 'sit', sits: 'sit',
    ran: 'run', runs: 'run',
    held: 'hold', holds: 'hold',
    knew: 'know', known: 'know', knows: 'know',
    found: 'find', finds: 'find',
    thought: 'think', thinks: 'think',
    told: 'tell', tells: 'tell',
    felt: 'feel', feels: 'feel',
    left: 'leave', leaves: 'leave',
    brought: 'bring', brings: 'bring',
    began: 'begin', begun: 'begin', begins: 'begin',
    kept: 'keep', keeps: 'keep',
    wrote: 'write', written: 'write', writes: 'write',
    spoke: 'speak', spoken: 'speak', speaks: 'speak',
    grew: 'grow', grown: 'grow', grows: 'grow',
    fell: 'fall', fallen: 'fall', falls: 'fall',
    led: 'lead', leads: 'lead',
    met: 'meet', meets: 'meet',
    sent: 'send', sends: 'send',
    built: 'build', builds: 'build',
    spent: 'spend', spends: 'spend',
    heard: 'hear', hears: 'hear',
    meant: 'mean', means: 'mean',
    lost: 'lose', loses: 'lose',
    won: 'win', wins: 'win',
    became: 'become', becomes: 'become',
    children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth', mice: 'mouse', people: 'person'
  };

  /* ---------- 基本詞形還原（保守：不規則 + 複數） ---------- */
  function lemma(w) {
    if (IRREGULAR[w]) return IRREGULAR[w];
    if (w.length >= 4) {
      if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
      if (/(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
      if (/ss$/.test(w)) return w;
      if (/s$/.test(w) && !/us$|is$/.test(w)) return w.slice(0, -1);
    }
    return w;
  }

  /* ---------- 收縮詞還原 ---------- */
  var CONTRACT = {
    "can't": 'can', "won't": 'will', "shan't": 'shall', "ain't": 'is'
  };
  function normalizeToken(src) {
    if (CONTRACT[src]) return CONTRACT[src];
    var s = src.replace(/'s$/, '').replace(/'(re|ve|ll|d|m)$/, '');
    if (/n't$/.test(s)) s = s.replace(/n't$/, '');
    return s;
  }

  /* ---------- 斷詞（保留內容詞，回傳 lemma 後的字） ---------- */
  function tokenize(text) {
    return tokenizeDetailed(text).map(function (p) { return p.w; });
  }

  /* ---------- 斷詞（回傳 { w: 原型, src: 原字 }） ---------- */
  function tokenizeDetailed(text) {
    var raw = String(text || '').toLowerCase().match(/[a-z][a-z']*/g) || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var src = raw[i].replace(/^'+|'+$/g, '');
      if (!src || src.length < 2) continue;
      var base = normalizeToken(src);
      if (!base || base.length < 2 || STOPWORDS[base]) continue;
      out.push({ w: lemma(base), src: src });
    }
    return out;
  }

  /* ---------- 句群切段：連續字幕句合併到至少 window 秒 ---------- */
  function buildSegments(subtitles, windowSec) {
    var win = windowSec > 0 ? windowSec : 10;
    var segs = [], cur = null;
    var list = subtitles || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!cur) cur = { start: s.start, end: s.end, texts: [s.text] };
      else { cur.end = s.end; cur.texts.push(s.text); }
      if (cur.end - cur.start >= win) { segs.push(cur); cur = null; }
    }
    if (cur) segs.push(cur);
    return segs;
  }

  /* ---------- 抽取詞匯（僅英文，無中文） ---------- */
  function extract(subtitles, windowSec) {
    var win = windowSec > 0 ? windowSec : 10;
    var raw = buildSegments(subtitles, win);
    var segments = raw.map(function (seg) {
      var seen = {}, words = [];
      seg.texts.forEach(function (t) {
        tokenizeDetailed(t).forEach(function (p) {
          if (!seen[p.w]) { seen[p.w] = true; words.push({ w: p.w, src: p.src, zh: '' }); }
        });
      });
      return { start: seg.start, end: seg.end, words: words };
    });
    return { window: win, segments: segments };
  }

  /* ---------- 正規化 JSON 內容 ---------- */
  function normalize(data) {
    if (!data || !Array.isArray(data.segments)) return null;
    var segments = data.segments.map(function (seg) {
      var words = (seg.words || []).map(function (it) {
        if (typeof it === 'string') return { w: it, src: it, zh: '' };
        var w = it.w || it.word || '';
        return { w: w, src: it.src || w, zh: it.zh || '' };
      }).filter(function (it) { return it.w; });
      return { start: +seg.start || 0, end: +seg.end || 0, words: words };
    }).filter(function (seg) { return seg.end > seg.start; });
    if (!segments.length) return null;
    return { window: +data.window || 10, segments: segments };
  }

  /* ---------- 載入 vocabulary/{videoId}.json（找不到回傳 null） ---------- */
  async function loadJson(path) {
    try {
      var res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) return null;
      var data = await res.json();
      return normalize(data);
    } catch (e) {
      return null;
    }
  }

  /* ---------- 主入口：先 JSON，失敗則前端抽取 ---------- */
  async function load(videoId, subtitles, options) {
    options = options || {};
    var win = options.window || 10;
    var path = options.vocabPath || ('vocabulary/' + videoId + '.json');
    var fromJson = await loadJson(path);
    if (fromJson) return { source: 'json', window: fromJson.window, segments: fromJson.segments };
    return { source: 'auto', window: win, segments: extract(subtitles, win).segments };
  }

  return {
    STOPWORDS: STOPWORDS,
    tokenize: tokenize,
    tokenizeDetailed: tokenizeDetailed,
    lemma: lemma,
    buildSegments: buildSegments,
    extract: extract,
    normalize: normalize,
    load: load
  };
})();
