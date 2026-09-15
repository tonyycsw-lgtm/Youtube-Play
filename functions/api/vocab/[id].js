/* ============================================================
   Cloudflare Pages Function — /api/vocab/{id}
   讀取存在 KV 的詞匯 JSON（老師於首頁「上載 JSON」新增時寫入）

   KV binding：KV_BINDING
   key：vocab:<id>
   ============================================================ */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const headers = corsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: headers });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers)
    });
  }

  if (!env || !env.KV_BINDING) {
    return new Response(JSON.stringify({ ok: false, error: 'kv_not_bound' }), {
      status: 500,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers)
    });
  }

  const id = String((params && params.id) || '').trim();
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_id' }), {
      status: 400,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers)
    });
  }

  const raw = await env.KV_BINDING.get('vocab:' + id);
  if (!raw) {
    return new Response(JSON.stringify({ ok: false, error: 'not_found', id: id }), {
      status: 404,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers)
    });
  }

  return new Response(raw, {
    status: 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, headers)
  });
}
