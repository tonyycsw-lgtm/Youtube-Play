/* ============================================================
   Cloudflare Pages Function — /api/captions
   自動抓取 YouTube 字幕（雙軌中的「自動」軌；老師上傳的 SRT 由前端優先讀取）

   流程：
   1. 抓取 watch 頁（帶 CONSENT cookie）→ 解析 ytInitialPlayerResponse → 字幕軌清單
   2. 依偏好語言挑選字幕軌
   3. 嘗試 timedtext json3 下載；失敗則嘗試 youtubei get_transcript
   4. 回傳結構化字幕；失敗時附上偵測到的軌清單，供前端提示老師上傳 SRT

   部署：functions/api/captions.js → 自動對應 https://{project}.pages.dev/api/captions
   ============================================================ */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CONSENT = 'CONSENT=YES+cb.20210328-17-p0.en+FX+417';
const ACCEPT_LANG = 'zh-Hant,zh;q=0.9,en;q=0.8';
const CACHE_TTL = 60 * 60 * 24; // 24 小時

/* ---------------- HTTP 輔助 ---------------- */
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      headers || {}
    )
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

/* ---------------- 快取（Workers Cache API，Node 測試環境自動略過） ---------------- */
async function cacheGet(key) {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open('utube-captions');
    const res = await cache.match(key);
    if (!res) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function cachePut(key, value) {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open('utube-captions');
    await cache.put(key, new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL }
    }));
  } catch (e) {
    /* 快取失敗不影響主流程 */
  }
}

/* ---------------- watch 頁解析 ---------------- */
function extractPlayerResponse(html) {
  const markers = ['ytInitialPlayerResponse = ', 'window["ytInitialPlayerResponse"] = '];
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;
    const first = html.indexOf('{', idx + marker.length);
    if (first === -1) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = first; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) return html.slice(first, i + 1);
        }
      }
    }
  }
  return null;
}

async function fetchPage(videoId) {
  const res = await fetch('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId), {
    headers: {
      'User-Agent': UA,
      'Accept-Language': ACCEPT_LANG,
      'Cookie': CONSENT
    }
  });
  if (!res.ok) return { html: '', playerResponse: null, apiKey: '', clientVersion: '', visitorData: '', transcriptParams: '' };
  const html = await res.text();
  const jsonStr = extractPlayerResponse(html);
  let playerResponse = null;
  try { playerResponse = jsonStr ? JSON.parse(jsonStr) : null; } catch (e) { playerResponse = null; }

  const apiKey = (html.match(/INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || '';
  const clientVersion = (html.match(/INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || '2.20240701.00.00';
  const visitorData = (html.match(/"VISITOR_DATA":"([^"]+)"/) || [])[1] || '';
  const gtPos = html.indexOf('getTranscriptEndpoint');
  const gtMatch = gtPos !== -1 ? html.slice(gtPos, gtPos + 400).match(/"params":"([^"]+)"/) : null;

  return { html, playerResponse, apiKey, clientVersion, visitorData, transcriptParams: gtMatch ? gtMatch[1] : '' };
}

function getTracks(playerResponse) {
  if (!playerResponse || !playerResponse.captions ||
      !playerResponse.captions.playerCaptionsTracklistRenderer) return [];
  const list = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
  return Array.isArray(list) ? list : [];
}

function summarizeTracks(tracks) {
  return tracks.map(function (t) {
    return { languageCode: t.languageCode || '', kind: t.kind || 'manual' };
  });
}

/* ---------------- 語言挑選 ---------------- */
function pickTrack(tracks, lang) {
  if (!tracks.length) return null;
  const want = (lang || '').toLowerCase();
  if (want) {
    const exact = tracks.find((t) => (t.languageCode || '').toLowerCase() === want);
    if (exact) return exact;
    const base = want.split('-')[0];
    const byBase = tracks.filter((t) => (t.languageCode || '').toLowerCase().startsWith(base));
    // 同語言優先選人工字幕（manual），其次自動
    const manual = byBase.find((t) => !t.kind || t.kind !== 'asr');
    if (manual) return manual;
    if (byBase.length) return byBase[0];
  }
  const en = tracks.find((t) => (t.languageCode || '').toLowerCase() === 'en');
  return en || tracks[0];
}

/* ---------------- 字幕下載：timedtext json3 ---------------- */
async function downloadTimedtext(track, videoId) {
  const baseUrl = track.baseUrl;
  if (!baseUrl) return null;
  const url = baseUrl.includes('?') ? baseUrl + '&fmt=json3' : baseUrl + '?fmt=json3';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://www.youtube.com/watch?v=' + videoId,
        'Origin': 'https://www.youtube.com',
        'Cookie': CONSENT
      }
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || !text.trim().startsWith('{')) return null;
    const data = JSON.parse(text);
    return (data.events || [])
      .map(function (ev) {
        const start = (ev.tStartMs || 0) / 1000;
        const end = (ev.tStartMs + (ev.dDurationMs || 0)) / 1000;
        const text = (ev.segs || []).map((s) => s.utf8 || '').join('').trim();
        return { start: start, end: end, text: text };
      })
      .filter((s) => s.text && s.end > s.start);
  } catch (e) {
    return null;
  }
}

/* ---------------- 字幕下載：youtubei get_transcript ---------------- */
async function downloadTranscript(videoId, page) {
  if (!page.transcriptParams || !page.apiKey) return null;
  const params = decodeURIComponent(page.transcriptParams);
  const body = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: page.clientVersion,
        hl: 'zh-Hant',
        visitorData: page.visitorData
      }
    },
    params: params
  };
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?key=' + page.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Origin': 'https://www.youtube.com' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const panel = (data.engagementPanels || [])[0];
    const renderer = panel && panel.engagementPanelSectionListRenderer &&
      panel.engagementPanelSectionListRenderer.content &&
      panel.engagementPanelSectionListRenderer.content.transcriptRenderer;
    const bodyRenderer = renderer && renderer.body && renderer.body.transcriptBodyRenderer;
    const groups = (bodyRenderer && bodyRenderer.cueGroups) || [];
    const subs = [];
    for (const g of groups) {
      const gr = g.transcriptCueGroupRenderer;
      if (!gr) continue;
      for (const c of gr.cues || []) {
        const cr = c.transcriptCueRenderer;
        if (!cr) continue;
        const start = (cr.startOffsetMs || 0) / 1000;
        const dur = (cr.durationMs || 0) / 1000;
        const text = (cr.cue && cr.cue.runs ? cr.cue.runs.map((r) => r.text || '').join('') : '').trim();
        if (text && dur > 0) subs.push({ start: start, end: start + dur, text: text });
      }
    }
    return subs.length ? subs : null;
  } catch (e) {
    return null;
  }
}

/* ---------------- 主流程 ---------------- */
async function fetchSubtitles(videoId, lang) {
  const page = await fetchPage(videoId);
  const tracks = getTracks(page.playerResponse);
  const summary = summarizeTracks(tracks);

  if (!tracks.length) {
    return { ok: false, subtitles: [], tracks: summary, error: 'no_captions', hint: 'upload_srt' };
  }

  const track = pickTrack(tracks, lang);
  if (!track) {
    return { ok: false, subtitles: [], tracks: summary, error: 'no_track', hint: 'upload_srt' };
  }

  const viaTimedtext = await downloadTimedtext(track, videoId);
  if (viaTimedtext && viaTimedtext.length) {
    return {
      ok: true, subtitles: viaTimedtext, tracks: summary,
      source: 'youtube', lang: track.languageCode || '', kind: track.kind || 'manual'
    };
  }

  const viaTranscript = await downloadTranscript(videoId, page);
  if (viaTranscript && viaTranscript.length) {
    return {
      ok: true, subtitles: viaTranscript, tracks: summary,
      source: 'youtube', lang: track.languageCode || '', kind: track.kind || 'manual'
    };
  }

  return {
    ok: false, subtitles: [], tracks: summary,
    error: 'download_blocked', hint: 'upload_srt', lang: track.languageCode || ''
  };
}

/* ---------------- 入口 ---------------- */
export async function onRequest(context) {
  const { request } = context;
  const headers = corsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: headers });
  }

  const url = new URL(request.url);
  let videoId = url.searchParams.get('videoId') || url.searchParams.get('v') || '';
  let lang = url.searchParams.get('lang') || 'en';

  if (url.searchParams.has('debug')) {
    const page = await fetchPage(videoId);
    const tracks = getTracks(page.playerResponse);
    let dlStatus = 'n/a', dlLen = 0;
    if (tracks.length) {
      const track = pickTrack(tracks, lang);
      if (track && track.baseUrl) {
        const u = track.baseUrl.includes('?') ? track.baseUrl + '&fmt=json3' : track.baseUrl + '?fmt=json3';
        try {
          const r = await fetch(u, {
            headers: { 'User-Agent': UA, 'Referer': 'https://www.youtube.com/watch?v=' + videoId, 'Origin': 'https://www.youtube.com', 'Cookie': CONSENT }
          });
          dlStatus = r.status + ' ' + (r.ok ? 'ok' : 'fail');
          dlLen = (await r.text()).length;
        } catch (e) { dlStatus = 'throw:' + e.message; }
      }
    }
    let trStatus = 'n/a', trCount = 0;
    try {
      const subs = await downloadTranscript(videoId, page);
      trStatus = subs ? 'ok' : 'null';
      trCount = subs ? subs.length : 0;
    } catch (e) { trStatus = 'throw:' + e.message; }
    return json({
      ok: true, videoId: videoId,
      htmlLength: page.html.length,
      playerResponseFound: !!page.playerResponse,
      playability: page.playerResponse && page.playerResponse.playabilityStatus && page.playerResponse.playabilityStatus.status,
      apiKeyFound: !!page.apiKey,
      transcriptParamsFound: !!page.transcriptParams,
      tracks: summarizeTracks(tracks),
      timedtext: { status: dlStatus, length: dlLen },
      transcript: { status: trStatus, count: trCount }
    }, 200, headers);
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body && body.videoId) videoId = body.videoId;
      if (body && body.lang) lang = body.lang;
    } catch (e) { /* 非 JSON body 時忽略 */ }
  }

  if (!videoId) {
    return json({ ok: false, error: 'missing videoId', hint: 'usage: POST {videoId, lang} 或 GET ?videoId=&lang=' }, 400, headers);
  }

  const cacheKey = 'captions:' + videoId + ':' + lang;
  const cached = await cacheGet(cacheKey);
  if (cached) return json(cached, 200, headers);

  const result = await fetchSubtitles(videoId, lang);
  await cachePut(cacheKey, result);
  return json(result, 200, headers);
}
