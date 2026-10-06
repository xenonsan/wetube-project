// --- Channel Page: Subscribe Button ---
(() => {
  const subBtn = document.getElementById('channelSubscribeButton');
  if (!subBtn) return;
  const channelId = subBtn.dataset.channelId;
  if (!channelId) return;

  function updateChannelSubBtn(subscribed) {
    subBtn.classList.toggle('subscribed', subscribed);
    subBtn.textContent = subscribed ? '登録済み' : 'チャンネル登録';
  }
  // Init state
  subBtn.disabled = true;
  getAccountAuthStatus(true).then(async auth => {
    if (auth.status === 'signed_in') {
      const response = await fetch('/api/account/channel-state?id=' + encodeURIComponent(channelId), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.authenticated || typeof data.subscribed !== 'boolean') {
        throw new Error(data.error || '登録状態を取得できませんでした。');
      }
      updateChannelSubBtn(data.subscribed);
    } else if (auth.status === 'signed_out') {
      const localSubs = safeJson('subscriptions', []);
      updateChannelSubBtn(localSubs.some(c => c.id === channelId));
    } else {
      throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
    }
  }).catch(error => {
    console.error('Channel subscription state:', error);
    notify(error.message || '登録状態を取得できませんでした。');
  }).finally(() => { subBtn.disabled = false; });

  subBtn.addEventListener('click', async () => {
    subBtn.disabled = true;
    try {
      const auth = await getAccountAuthStatus(true);
      if (auth.status === 'signed_in') {
        const stateResponse = await fetch('/api/account/channel-state?id=' + encodeURIComponent(channelId));
        const state = await stateResponse.json();
        if (!stateResponse.ok || !state.authenticated || typeof state.subscribed !== 'boolean') {
          throw new Error(state.error || '登録状態を取得できませんでした。');
        }
        const action = state.subscribed ? 'unsubscribe' : 'subscribe';
        const res = await fetch('/api/interact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, channelId })
        });
        const data = await res.json();
        const expected = action === 'subscribe';
        if (!res.ok || data.ok !== true || data.subscribed !== expected) {
          throw new Error(data.error || '操作結果を確認できませんでした。');
        }
        updateChannelSubBtn(data.subscribed);
        notify(data.subscribed ? 'チャンネル登録しました' : 'チャンネル登録を解除しました');
      } else if (auth.status === 'signed_out') {
        let list = safeJson('subscriptions', []);
        const joined = list.some(x => x.id === channelId);
        const channelName = document.querySelector('.channel-identity h1')?.textContent || channelId;
        list = joined ? list.filter(x => x.id !== channelId) : [{ id: channelId, name: channelName }, ...list];
        saveJson('subscriptions', list);
        updateChannelSubBtn(!joined);
        notify(!joined ? 'チャンネル登録しました' : 'チャンネル登録を解除しました');
      } else {
        throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
      }
    } catch (err) {
      notify(err.message || 'エラーが発生しました');
    } finally {
      subBtn.disabled = false;
    }
  });
})();
