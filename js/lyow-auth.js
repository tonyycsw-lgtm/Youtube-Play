/* ============================================================
   共用 lyow Firebase 登入狀態（同源代理於 lyow.app/y/ 時生效）
   - 只提供「是否 admin」給前端做 UX 隱藏（fail-closed）
   - 真正的權限檢查在 Cloudflare Function（functions/api/_auth.js）
   - 對外介面：window.__LYOW__ = { ready, user, isAdmin, getIdToken() }
   ============================================================ */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBaD7W4K22i_4kBlNQkZ1oj14tYzGamoWk',
  authDomain: 'lyow-main.firebaseapp.com',
  projectId: 'lyow-main',
  storageBucket: 'lyow-main.firebasestorage.app',
  messagingSenderId: '942451081444',
  appId: '1:942451081444:web:251a80e6be82bc4460ecf1'
};

const state = { user: null, isAdmin: false };

let resolveReady;
const ready = new Promise(function (resolve) { resolveReady = resolve; });

function applyAdminUI(isAdmin) {
  document.documentElement.classList.toggle('is-admin', isAdmin);
  document.querySelectorAll('[data-admin-only]').forEach(function (el) {
    el.hidden = !isAdmin;
  });
}

window.__LYOW__ = {
  ready: ready,
  get user() { return state.user; },
  get isAdmin() { return state.isAdmin; },
  async getIdToken() {
    if (!state.user) return null;
    try { return await state.user.getIdToken(); } catch (e) { return null; }
  }
};

try {
  const auth = getAuth(initializeApp(firebaseConfig));
  onAuthStateChanged(auth, async function (user) {
    state.user = user;
    let isAdmin = false;
    if (user) {
      try {
        const result = await user.getIdTokenResult(true);
        isAdmin = result.claims.admin === true;
      } catch (e) { isAdmin = false; }
    }
    state.isAdmin = isAdmin;
    applyAdminUI(isAdmin);
    window.dispatchEvent(new CustomEvent('lyow-auth-ready', { detail: { isAdmin: isAdmin } }));
    resolveReady(isAdmin);
  });
} catch (e) {
  applyAdminUI(false);
  resolveReady(false);
}
