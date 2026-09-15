/* ============================================================
   Cloudflare Pages Function — /api/resolve
   解析短連結（例如抖音 v.douyin.com）→ 跟隨轉址後回傳最終網址

   用法：GET /api/resolve?url=<短連結>
   僅允許已知短連結網域（避免 SSRF）
   ============================================================ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ALLOWED_HOST_RE = /(^|\.)(douyin\.com|iesdouyin\.com)$/i;

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export async function onRequest(context) {
  const { request } = context;
  const headers = corsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: headers });
  }

  const url = new URL(request.url);
  const target = String(url.searchParams.get('url') || '').trim();

  if (!/^https?:\/\//i.test(target)) {
    return json({ ok: false, error: 'invalid_url' }, 400, headers);
  }

  let host = '';
  try { host = new URL(target).hostname; } catch (e) {
    return json({ ok: false, error: 'invalid_url' }, 400, headers);
  }
  if (!ALLOWED_HOST_RE.test(host)) {
    return json({ ok: false, error: 'host_not_allowed', note: '僅允許解析已知短連結網域。' }, 400, headers);
  }

  try {
    const res = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-Hant,zh;q=0.9,en;q=0.8' }
    });
    const finalUrl = res.url || target;
    return json({ ok: true, url: finalUrl }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: 'resolve_error', note: String((e && e.message) || e) }, 502, headers);
  }
}
