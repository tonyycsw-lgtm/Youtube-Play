/* ============================================================
   Firebase ID token 驗證（Cloudflare Pages Functions，零依賴）
   - 只信任 lyow-main 專案簽發、且 custom claim admin === true 的 token
   - RS256 簽章以 WebCrypto 驗證；金鑰走 Google 公開 JWKS 並快取 1 小時
   - 檔名前綴 _ 不會被 Pages 路由，只能被其他 Function import
   ============================================================ */

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwksCache = { keys: null, exp: 0 };

function base64UrlToBytes(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlToString(str) {
  return new TextDecoder().decode(base64UrlToBytes(str));
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.exp > now) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks_fetch_failed');
  const data = await res.json();
  jwksCache = { keys: data.keys || [], exp: now + 3600 * 1000 };
  return jwksCache.keys;
}

async function verifyIdToken(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');

  const header = JSON.parse(base64UrlToString(parts[0]));
  const payload = JSON.parse(base64UrlToString(parts[1]));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad_header');

  const jwk = (await getJwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('no_matching_key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!valid) throw new Error('bad_signature');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error('expired');
  if (payload.iat && payload.iat > now + 60) throw new Error('iat_in_future');
  if (payload.aud !== projectId) throw new Error('bad_audience');
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('bad_issuer');
  if (!payload.sub) throw new Error('bad_subject');

  return payload;
}

export async function requireAdmin(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { ok: false, status: 401, error: 'unauthorized' };

  const projectId = (env && env.FIREBASE_PROJECT_ID) || 'lyow-main';
  try {
    const payload = await verifyIdToken(token, projectId);
    if (payload.admin !== true) return { ok: false, status: 403, error: 'forbidden' };
    return { ok: true, uid: payload.sub };
  } catch (e) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
}
