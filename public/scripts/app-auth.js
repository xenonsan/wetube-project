// --- Auth Dialog Controller (YouTube TV OAuth2) ---
(() => {
  const dialog = $('#authDialog');
  if (!dialog) return;

  const sections = {
    signed_out: $('#authSignedOut'),
    starting: $('#authPending'),
    pending: $('#authPending'),
    signed_in: $('#authSignedIn'),
    error: $('#authError')
  };
  let pollTimer = null;
  let wasSignedIn = document.body.dataset.authenticated === 'true';

  function showSection(status) {
    Object.values(sections).forEach(s => { if (s) s.hidden = true; });
    (sections[status] || sections.signed_out).hidden = false;
  }

  function setAccountAvatar(element, url, fallback) {
    if (!element) return;
    if (!url) {
      element.textContent = fallback;
      return;
    }
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    element.replaceChildren(image);
  }

  dialog.querySelector('.modal-close')?.addEventListener('click', () => {
    dialog.hidden = true;
    clearTimeout(pollTimer);
  });
  dialog.addEventListener('wetube:auth-open', refreshAuthStatus);

  function showAuthError(message) {
    clearTimeout(pollTimer);
    const errorMessage = $('#authErrorMessage');
    if (errorMessage) errorMessage.textContent = message || '認証を開始できませんでした。時間をおいて再試行してください。';
    showSection('error');
  }

  async function refreshAuthStatus() {
    try {
      const res = await getAccountAuthStatus(true);
      if (res.status === 'error') {
        showAuthError(res.error);
        return;
      }
      if (res.status === 'signed_out' && res.error) {
        showAuthError(res.error);
        return;
      }
      showSection(res.status);

      const signedIn = res.status === 'signed_in';
      if (signedIn && !wasSignedIn) {
        window.dispatchEvent(new CustomEvent('wetube:auth-changed', { detail: { signedIn: true } }));
      }
      wasSignedIn = signedIn;
      const account = signedIn ? res.account : null;
      setAccountAvatar($('#accountAvatar'), account?.avatar, signedIn ? '✓' : 'W');
      setAccountAvatar($('.account-avatar-lg'), account?.avatar, signedIn ? '✓' : 'W');
      setAccountAvatar($('#authAccountAvatar'), account?.avatar, signedIn ? '✓' : 'W');

      const menuName = $('#menuAccountName');
      const menuHandle = $('#menuAccountHandle');
      if (menuName) menuName.textContent = account?.name || 'ログインしていません';
      if (menuHandle) menuHandle.textContent = account?.handle || (signedIn ? 'YouTubeアカウント' : 'YouTubeアカウントでログイン');
      const dialogName = $('#authAccountName');
      const dialogHandle = $('#authAccountHandle');
      if (dialogName) dialogName.textContent = account?.name || 'YouTubeアカウント';
      if (dialogHandle) dialogHandle.textContent = account?.handle || '';

      if (res.status === 'pending' || res.status === 'starting') {
        const codeBtn = $('#copyAuthCode');
        const verificationLink = $('#authVerificationLink');
        if (codeBtn) codeBtn.textContent = res.userCode || '認証コードを取得しています…';
        if (codeBtn) codeBtn.disabled = !res.userCode;
        if (verificationLink && res.verificationUrl) {
          verificationLink.href = res.verificationUrl;
        }
        clearTimeout(pollTimer);
        pollTimer = setTimeout(refreshAuthStatus, 2000);
      }
    } catch (error) {
      showAuthError(error.message);
    }
  }

  async function startAuth() {
    clearTimeout(pollTimer);
    const codeBtn = $('#copyAuthCode');
    if (codeBtn) {
      codeBtn.textContent = '認証コードを取得しています…';
      codeBtn.disabled = true;
    }
    showSection('starting');
    try {
      const response = await fetch('/api/auth/start', { method: 'POST' });
      const result = await response.json();
      if (!response.ok || result.status === 'error') throw new Error(result.error || '認証を開始できませんでした。');
      await refreshAuthStatus();
    } catch (error) {
      showAuthError(error.message);
    }
  }

  $('#startAuthButton')?.addEventListener('click', startAuth);
  $('#retryAuthButton')?.addEventListener('click', startAuth);

  $('#copyAuthCode')?.addEventListener('click', async () => {
    const code = $('#copyAuthCode')?.textContent.trim();
    if (code && !$('#copyAuthCode')?.disabled) {
      await navigator.clipboard.writeText(code);
      notify('認証コードをコピーしました');
    }
  });

  $('#signOutButton')?.addEventListener('click', async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    localStorage.removeItem('recommendationCache');
    notify('ログアウトしました');
    setTimeout(() => location.reload(), 400);
  });

  refreshAuthStatus();
})();
