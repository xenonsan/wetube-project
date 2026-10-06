// --- Sidebar Subscriptions Hydration ---
(() => {
  const container = $('#sidebarSubscriptions');
  if (!container) return;

  function renderSidebarChannels(channels) {
    if (!channels.length) {
      container.innerHTML = '<span class="sidebar-empty-text">登録チャンネルはありません</span>';
      return;
    }
    container.innerHTML = channels.slice(0, 15).map(c => `
      <a class="sidebar-channel-item" href="/channel/${encodeURIComponent(c.id)}">
        ${c.thumbnail || c.avatar ? `<img src="${esc(c.thumbnail || c.avatar)}" alt="">` : `<span class="sidebar-channel-fallback">${esc((c.name || 'C').slice(0, 1))}</span>`}
        <span>${esc(c.name)}</span>
      </a>
    `).join('');
  }

  async function loadSidebarSubs() {
    let authenticated = document.body.dataset.authenticated === 'true';
    try {
      const auth = await getAccountAuthStatus(true);
      authenticated = auth.status === 'signed_in';
    } catch (error) {
      console.error('Sidebar authentication status:', error);
      container.innerHTML = `<span class="sidebar-empty-text">${esc(error.message || 'アカウント状態を確認できませんでした。')}</span>`;
      return;
    }
    if (authenticated) {
      try {
        const response = await fetch('/api/account/subscriptions');
        const res = await response.json();
        if (!response.ok) throw new Error(res.error || '登録チャンネルを取得できませんでした。');
        renderSidebarChannels(res.channels || []);
        return;
      } catch (error) {
        console.error('Sidebar subscriptions:', error);
        container.innerHTML = `<span class="sidebar-empty-text">${esc(error.message || '登録チャンネルを取得できませんでした。')}</span>`;
        return;
      }
    }
    if (authenticated !== false) {
      container.innerHTML = '<span class="sidebar-empty-text">登録チャンネルを取得できませんでした。</span>';
      return;
    }
    const local = safeJson('subscriptions', []);
    renderSidebarChannels(local);
  }

  loadSidebarSubs();
})();
