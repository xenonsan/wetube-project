// --- Card Action Menu (More '...' button) ---
(() => {
  const menu = $('#cardActionMenu');
  if (!menu) return;
  let activeVideoId = '';
  let activeVideoTitle = '';

  document.addEventListener('click', e => {
    const btn = e.target.closest('.more-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      activeVideoId = btn.dataset.videoId || '';
      activeVideoTitle = btn.dataset.title || '';
      if (!activeVideoId) {
        const card = btn.closest('.video-card, .related-card-wrap');
        activeVideoId = card?.dataset?.videoId || new URL(card?.querySelector('a[href*="/watch?v="]')?.href || '', location.href).searchParams.get('v') || '';
      }
      if (!activeVideoId) return;

      const rect = btn.getBoundingClientRect();
      menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
      menu.style.left = `${Math.min(window.innerWidth - 220, rect.left + window.scrollX - 160)}px`;
      menu.hidden = false;
      return;
    }
    if (!e.target.closest('.card-action-menu')) {
      menu.hidden = true;
    }
  });

  $('#cardActionQueue')?.addEventListener('click', async () => {
    menu.hidden = true;
    if (!activeVideoId) return;
    try {
      const auth = await getAccountAuthStatus();
      if (auth.status !== 'signed_out') {
        notify('ログイン中はGoogleアカウントのデータのみ使用するため、ローカルのキューは利用できません。');
        return;
      }
      const q = safeJson('queue', []).filter(x => x !== activeVideoId);
      q.push(activeVideoId);
      saveJson('queue', q);
      notify('キューに追加しました');
    } catch (error) {
      notify(error.message || 'アカウント状態を確認できませんでした。');
    }
  });

  $('#cardActionSave')?.addEventListener('click', async () => {
    menu.hidden = true;
    if (!activeVideoId) return;
    try {
      const auth = await getAccountAuthStatus(true);
      if (auth.status === 'signed_in') {
        const stateResponse = await fetch(`/api/account/watch-later?videoId=${encodeURIComponent(activeVideoId)}`, { cache:'no-store' });
        const state = await stateResponse.json();
        if (!stateResponse.ok || !state.authenticated || typeof state.saved !== 'boolean') {
          throw new Error(state.error || 'Googleアカウントの「後で見る」を取得できませんでした。');
        }
        const response = await fetch('/api/account/watch-later', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ action:state.saved ? 'remove' : 'add', videoId:activeVideoId })
        });
        const data = await response.json();
        if (!response.ok || !data.authenticated || data.ok !== true) {
          throw new Error(data.error || 'Googleアカウントの「後で見る」を更新できませんでした。');
        }
        notify(data.saved ? 'Googleアカウントの「後で見る」に保存しました' : 'Googleアカウントの「後で見る」から削除しました');
      } else if (auth.status === 'signed_out') {
        const list = safeJson('watchLater', []);
        const exists = list.includes(activeVideoId);
        saveJson('watchLater', exists ? list.filter(x => x !== activeVideoId) : [activeVideoId, ...list].slice(0, 100));
        notify(exists ? '後で見るから削除しました' : '後で見るに保存しました');
      } else {
        throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
      }
    } catch (error) {
      notify(error.message || '後で見るを更新できませんでした。');
    }
  });

  $('#cardActionShare')?.addEventListener('click', async () => {
    menu.hidden = true;
    const url = `${location.origin}/watch?v=${activeVideoId}`;
    try {
      await navigator.share({ title: activeVideoTitle || document.title, url });
    } catch {
      await navigator.clipboard.writeText(url);
      notify('URLをクリップボードにコピーしました');
    }
  });

  $('#cardActionCopy')?.addEventListener('click', async () => {
    menu.hidden = true;
    const url = `${location.origin}/watch?v=${activeVideoId}`;
    await navigator.clipboard.writeText(url);
    notify('リンクをコピーしました');
  });
})();
