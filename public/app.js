/**
 * YouTube Web Client - Core Application JavaScript
 * Fully aligned with official YouTube UI, UX, and interactions.
 */

// --- Utilities ---
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const accountDataStorageKeys = new Set([
  'history', 'watchLater', 'subscriptions', 'likedVideos', 'dislikedVideos',
  'searchHistory', 'recommendationCache', 'queue'
]);
const canUseLocalAccountData = key => !accountDataStorageKeys.has(key) || document.body.dataset.authenticated !== 'true';
const safeJson = (key, fallback = []) => {
  if (!canUseLocalAccountData(key)) return fallback;
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
};
const saveJson = (key, val) => {
  if (canUseLocalAccountData(key)) localStorage.setItem(key, JSON.stringify(val));
};
let accountAuthStatusPromise;
function getAccountAuthStatus(refresh = false) {
  if (refresh || !accountAuthStatusPromise) {
    accountAuthStatusPromise = fetch('/api/auth/status', { cache: 'no-store' }).then(async response => {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('アカウント状態を確認できませんでした。');
      const result = await response.json();
      if (!response.ok || !['signed_in', 'signed_out', 'starting', 'pending', 'error'].includes(result.status) ||
          (result.status === 'signed_out' && result.error)) {
        throw new Error(result.error || 'アカウント状態を確認できませんでした。');
      }
      const wasAuthenticated = document.body.dataset.authenticated === 'true';
      const isAuthenticated = result.status === 'signed_in';
      if (['signed_in', 'signed_out'].includes(result.status)) {
        document.body.dataset.authenticated = String(isAuthenticated);
      }
      if (['signed_in', 'signed_out'].includes(result.status) && wasAuthenticated !== isAuthenticated) {
        document.dispatchEvent(new CustomEvent('wetube:auth-changed', { detail: { authenticated: isAuthenticated } }));
      }
      return result;
    }).catch(error => {
      accountAuthStatusPromise = null;
      throw error;
    });
  }
  return accountAuthStatusPromise;
}
function isShortcutBlocked(event) {
  const selector = 'input, textarea, select, button, summary, details[open], [contenteditable="true"], [role="textbox"], [role="dialog"], [role="menu"], [role="menuitem"], dialog, .modal-panel:not([hidden]), .header-popover:not([hidden]), .card-action-menu:not([hidden]), #shortComments.open';
  const target = event.target instanceof Element ? event.target : null;
  const active = document.activeElement instanceof Element ? document.activeElement : null;
  return Boolean(
    target?.closest(selector) ||
    active?.closest(selector) ||
    document.body.classList.contains('queue-open')
  );
}
if (['home', 'search'].includes(document.body.dataset.page) && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  let previewTimer = null;
  let activePreview = null;
  const previewsEnabled = () => localStorage.getItem('videoPreviews') === 'true';
  const stopPreview = thumb => {
    if (!thumb) return;
    thumb.querySelector('.video-preview-frame')?.remove();
    if (activePreview === thumb) activePreview = null;
  };
  document.addEventListener('pointerover', event => {
    if (!previewsEnabled()) return;
    const thumb = event.target instanceof Element ? event.target.closest('.video-card .thumb') : null;
    const card = thumb?.closest('.video-card');
    const id = card?.dataset.videoId || '';
    if (!thumb || !/^[\w-]{11}$/.test(id) || (event.relatedTarget instanceof Node && thumb.contains(event.relatedTarget))) return;
    clearTimeout(previewTimer);
    if (activePreview && activePreview !== thumb) stopPreview(activePreview);
    previewTimer = setTimeout(() => {
      if (!thumb.matches(':hover') || !thumb.isConnected) return;
      const frame = document.createElement('iframe');
      frame.className = 'video-preview-frame';
      frame.title = 'ミュートされた動画プレビュー';
      frame.allow = 'autoplay; encrypted-media';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0`;
      thumb.append(frame);
      activePreview = thumb;
    }, 650);
  });
  window.addEventListener('storage', event => {
    if (event.key === 'videoPreviews') {
      if (event.newValue !== 'true') {
        clearTimeout(previewTimer);
        stopPreview(activePreview);
      }
    }
  });
  document.addEventListener('pointerout', event => {
    const thumb = event.target instanceof Element ? event.target.closest('.video-card .thumb') : null;
    if (!thumb || (event.relatedTarget instanceof Node && thumb.contains(event.relatedTarget))) return;
    clearTimeout(previewTimer);
    stopPreview(thumb);
  });
}
document.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.dataset.videoFallback) return;
  if (!image.dataset.fallbackUsed) {
    image.dataset.fallbackUsed = 'true';
    image.src = `https://i.ytimg.com/vi/${encodeURIComponent(image.dataset.videoFallback)}/hqdefault.jpg`;
  } else {
    image.classList.add('image-unavailable');
    image.removeAttribute('src');
  }
}, true);
function recordLocalHistory(videoId) {
  if (document.body.dataset.authenticated === 'true' || !/^[\w-]{11}$/.test(String(videoId || ''))) return;
  const history = safeJson('history', [])
    .map(item => typeof item === 'string' ? item : item?.id)
    .filter(id => /^[\w-]{11}$/.test(String(id || '')) && id !== videoId);
  saveJson('history', [videoId, ...history].slice(0, 50));
}
async function recordHistoryForCurrentAccount(videoId) {
  try {
    const auth = await getAccountAuthStatus();
    if (auth.status === 'signed_out') recordLocalHistory(videoId);
  } catch (error) {
    console.error('History account status:', error);
  }
}
function newPlaybackSessionId() {
  return crypto.randomUUID();
}
const accountHistoryRequests = new Set();
async function recordAccountWatch(videoId, playbackSessionId) {
  if (!/^[\w-]{11}$/.test(String(videoId || '')) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(playbackSessionId || ''))) return;
  const requestKey = `${videoId}:${playbackSessionId}`;
  if (accountHistoryRequests.has(requestKey)) return;
  accountHistoryRequests.add(requestKey);
  try {
    const auth = await getAccountAuthStatus();
    if (auth.status !== 'signed_in') {
      accountHistoryRequests.delete(requestKey);
      return;
    }
    const response = await fetch('/api/account/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, playbackSessionId })
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`視聴履歴APIからJSON以外の応答が返りました (${response.status})。`);
    }
    const result = await response.json();
    if (response.ok && result.accepted === true) {
      if (result.verified !== true) {
        console.warn(`Account watch history accepted but not yet visible [${videoId}]`);
      }
      return;
    }
    if (!response.ok || result.ok !== true || result.verified !== true) {
      accountHistoryRequests.delete(requestKey);
      throw new Error(result.error || (result.accepted ? '視聴履歴への反映をまだ確認できません。' : '視聴履歴を保存できませんでした。'));
    }
  } catch (error) {
    accountHistoryRequests.delete(requestKey);
    console.error('Account watch history update:', error);
  }
}

const toast = $('#toast');
function notify(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2400);
}
