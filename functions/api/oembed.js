/* ============================================================
   Cloudflare Pages Function — /api/oembed
   代理 YouTube oEmbed，讓前端貼上連結時自動帶入標題與縮圖
   （直接從瀏覽器呼叫 oEmbed 會有 CORS 問題，故由此代理）

   用法：GET /api/oembed?v=<videoId>
   ============================================================ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
  const v = String(url.searchParams.get('v') || url.searchParams.get('videoId') || '').trim();
  const full = String(url.searchParams.get('url') || '').trim();

  let target = '';
  let provider = 'youtube';

  if (v) {
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(v)) {
      return json({ ok: false, error: 'invalid_video_id' }, 400, headers);
    }
    target = 'https://www.youtube.com/oembed?url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + v) + '&format=json';
  } else if (full && /tiktok\.com/i.test(full)) {
    provider = 'tiktok';
    target = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(full);
  } else if (full && /^https?:\/\//i.test(full)) {
    target = 'https://www.youtube.com/oembed?url=' + encodeURIComponent(full) + '&format=json';
  } else {
    return json({ ok: false, error: 'missing_url', note: '請提供 ?v=<YouTube ID> 或 ?url=<影片網址>' }, 400, headers);
  }

  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-Hant,zh;q=0.9,en;q=0.8' }
    });
    if (!res.ok) {
      return json({ ok: false, error: 'oembed_failed', status: res.status }, 502, headers);
    }
    const data = await res.json();
    return json({
      ok: true,
      provider: provider,
      title: data.title || '',
      author: data.author_name || '',
      thumbnail: data.thumbnail_url || ''
    }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: 'oembed_error', note: String(e && e.message || e) }, 502, headers);
  }
}
