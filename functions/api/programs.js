/* ============================================================
   Cloudflare Pages Function — /api/programs
   自訂節目清單（存在 KV；與靜態 programs.json 並存）

   - GET  /api/programs            列出所有自訂節目
   - POST /api/programs            新增或更新節目（同 videoId 直接覆寫；可同時存入詞匯 JSON）

   KV binding：KV_BINDING
   key：program:<videoId>（節目資料）、vocab:<videoId>（詞匯 JSON 字串）
   ============================================================ */

const PREFIX_PROGRAM = 'program:';
const PREFIX_VOCAB = 'vocab:';
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

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

function noBinding() {
  return json({
    ok: false,
    error: 'kv_not_bound',
    note: '尚未綁定 KV。請在 Cloudflare Pages 專案的 Settings → Functions → KV namespace bindings 綁定 KV_BINDING，或確認 wrangler.toml 的 kv_namespaces 設定。'
  }, 500);
}

async function listPrograms(env) {
  const out = [];
  let cursor = undefined;
  do {
    const res = await env.KV_BINDING.list({ prefix: PREFIX_PROGRAM, cursor });
    for (const key of res.keys) {
      const raw = await env.KV_BINDING.get(key.name);
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch (e) { /* 略過壞資料 */ }
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  out.sort(function (a, b) {
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  return out;
}

async function handleGet(env, headers) {
  const programs = await listPrograms(env);
  return json({ ok: true, programs: programs }, 200, headers);
}

async function handlePost(env, request, headers) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'invalid_json', note: '請求內容不是有效 JSON。' }, 400, headers);
  }

  const videoId = String((body && body.videoId) || '').trim();
  if (!VIDEO_ID_RE.test(videoId)) {
    return json({ ok: false, error: 'invalid_video_id', note: '無法辨識 YouTube 影片 ID。' }, 400, headers);
  }

  const title = String((body && body.title) || '').trim() || videoId;
  const lang = String((body && body.lang) || 'en').trim() || 'en';
  const description = String((body && body.description) || '').trim();

  const existingRaw = await env.KV_BINDING.get(PREFIX_PROGRAM + videoId);
  let createdAt = new Date().toISOString();
  if (existingRaw) {
    try {
      const prev = JSON.parse(existingRaw);
      if (prev && prev.createdAt) createdAt = prev.createdAt;
    } catch (e) { /* 舊資料壞掉時忽略 */ }
  }

  const program = {
    id: videoId,
    title: title,
    videoId: videoId,
    lang: lang,
    description: description,
    custom: true,
    createdAt: createdAt
  };

  await env.KV_BINDING.put(PREFIX_PROGRAM + videoId, JSON.stringify(program));

  let vocabSaved = false;
  if (body && body.vocab && typeof body.vocab === 'object') {
    try {
      await env.KV_BINDING.put(PREFIX_VOCAB + videoId, JSON.stringify(body.vocab));
      vocabSaved = true;
    } catch (e) { /* 詞匯存檔失敗不影響節目新增 */ }
  }

  return json({ ok: true, updated: !!existingRaw, program: program, vocabSaved: vocabSaved }, 200, headers);
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: headers });
  }

  if (!env || !env.KV_BINDING) return noBinding();

  if (request.method === 'GET') return handleGet(env, headers);
  if (request.method === 'POST') return handlePost(env, request, headers);

  return json({ ok: false, error: 'method_not_allowed' }, 405, headers);
}
