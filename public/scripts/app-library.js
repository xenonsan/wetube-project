// --- Library (History, Watch Later, Liked, Playlists) ---
(() => {
  if (document.body.dataset.page !== 'library') return;

  const page = $('.library-page');
  const type = page?.dataset.library;
  const grid = $('#libraryGrid');
  const status = $('#libraryStatus');
  const clearBtn = $('#clearLibrary');
  const playAllBtn = $('#playAllBtn');
  const searchInput = $('#librarySearch');
  const sortSelect = $('#librarySort');
  const countEl = $('#libraryCount');
  let isAuth = document.body.dataset.authenticated === 'true';
  let historyCursor = '';
  let historyLoading = false;
  let historyObserver;
  let historyStatus;
  let historyMessage;
  let historyMoreButton;
  let historyRetryBlocked = false;
  let historyCheckScheduled = false;

  const keys = { history: 'history', watchLater: 'watchLater', subscriptions: 'subscriptions' };
  const storageKey = keys[type];

  function renderVideoCard(v) {
    const href = v.isShort ? `/shorts/${encodeURIComponent(v.id)}` : `/watch?v=${encodeURIComponent(v.id)}`;
    return `
      <article class="video-card" data-video-id="${esc(v.id)}">
        <a class="thumb" href="${href}">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy" data-video-fallback="${esc(v.id)}">
          ${v.duration ? `<span class="duration">${esc(v.duration)}</span>` : ''}
          ${v.isShort ? '<span class="shorts-video-badge">Shorts</span>' : ''}
        </a>
        <div class="card-info">
          ${v.authorId ? `<a class="channel-avatar-link" href="/channel/${encodeURIComponent(v.authorId)}">` : ''}
            ${v.authorThumbnail ? `<img class="channel-avatar" src="${esc(v.authorThumbnail)}" alt="">` : `<span class="channel-avatar fallback">${esc((v.author || 'Y').slice(0, 1))}</span>`}
          ${v.authorId ? '</a>' : ''}
          <div class="card-copy">
            <a class="video-title" href="${href}">${esc(v.title)}</a>
            ${v.authorId ? `<a class="channel-name-link" href="/channel/${encodeURIComponent(v.authorId)}">${esc(v.author)}</a>` : `<span>${esc(v.author)}</span>`}
            <span>${esc([v.views, v.published].filter(Boolean).join('・'))}</span>
          </div>
          <button class="more-btn" aria-label="その他のアクション" data-video-id="${esc(v.id)}" data-title="${esc(v.title)}">
            <svg class="icon"><use href="#i-more"></use></svg>
          </button>
        </div>
      </article>
    `;
  }

  function renderChannelCard(c) {
    return `
      <a class="subscription-card" href="/channel/${encodeURIComponent(c.id)}">
        ${c.thumbnail || c.avatar ? `<img src="${esc(c.thumbnail || c.avatar)}" alt="">` : `<span class="subscription-fallback">${esc((c.name || 'C').slice(0, 1))}</span>`}
        <b>${esc(c.name)}</b>
        <span>${esc([c.handle, c.subscribers].filter(Boolean).join('・') || 'チャンネルを表示')}</span>
      </a>
    `;
  }

  async function loadLibraryData() {
    status.hidden = false;
    status.innerHTML = '<span class="yt-loading-ring"></span><span>読み込み中...</span>';
    grid.innerHTML = '';

    const fetchJson = async url => {
      const response = await fetch(url);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`APIからJSON以外の応答が返りました (${response.status})。ページを再読み込みしてください。`);
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'データを取得できませんでした。');
      return data;
    };
    const showError = error => {
      status.hidden = true;
      grid.innerHTML = `<div class="library-empty">${esc(error.message || 'データを取得できませんでした。')}</div>`;
      if (countEl) countEl.textContent = '';
    };

    try {
      const auth = await getAccountAuthStatus(true);
      if (!['signed_in', 'signed_out'].includes(auth.status)) {
        throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
      }
      isAuth = auth.status === 'signed_in';
    } catch (error) {
      showError(error);
      return;
    }

    if (isAuth && type === 'subscriptions') {
      if (clearBtn) clearBtn.hidden = true;
      try {
        grid.classList.add('channel-library');
        const res = await fetchJson('/api/account/subscriptions');
        const channels = res.channels || [];
        status.hidden = true;
        grid.innerHTML = channels.length ? channels.map(renderChannelCard).join('') : '<div class="library-empty">登録チャンネルはありません</div>';
        if (countEl) countEl.textContent = `${channels.length}件`;
        return;
      } catch (error) {
        showError(error);
        return;
      }
    }

    if (type === 'likedVideos') {
      if (clearBtn) clearBtn.hidden = true;
      if (!isAuth) {
        status.hidden = true;
        grid.innerHTML = '<div class="library-empty">高く評価した動画を表示するにはYouTubeアカウントにログインしてください。<br><button id="likedVideosLogin" class="pill active" type="button">ログイン</button></div>';
        $('#likedVideosLogin')?.addEventListener('click', () => {
          const dialog = $('#authDialog');
          if (dialog) dialog.hidden = false;
        });
        if (countEl) countEl.textContent = '';
        return;
      }
      try {
        const result = await fetchJson('/api/account/liked');
        const videos = result.videos || [];
        status.hidden = true;
        grid.innerHTML = videos.length ? videos.map(renderVideoCard).join('') : '<div class="library-empty">高く評価した動画はありません</div>';
        if (countEl) countEl.textContent = `${videos.length}件`;
      } catch (error) {
        showError(error);
      }
      return;
    }

    if (isAuth && type === 'watchLater') {
      if (clearBtn) clearBtn.hidden = true;
      try {
        const result = await fetchJson('/api/account/watch-later');
        const videos = result.videos || [];
        status.hidden = true;
        grid.innerHTML = videos.length ? videos.map(renderVideoCard).join('') : '<div class="library-empty">Googleアカウントの「後で見る」に動画はありません</div>';
        if (countEl) countEl.textContent = `${videos.length}件`;
      } catch (error) {
        showError(error);
      }
      return;
    }

    if (type === 'history' && isAuth) {
      if (clearBtn) clearBtn.hidden = true;
      try {
        const result = await fetchJson('/api/account/history');
        if (!result.authenticated || result.source !== 'google-account') {
          throw new Error('Googleアカウントの視聴履歴を取得できませんでした。');
        }
        const accountHistory = result.videos || [];
        status.hidden = true;
        grid.innerHTML = accountHistory.length
          ? accountHistory.map(renderVideoCard).join('')
          : '<div class="library-empty">Googleアカウントの視聴履歴はありません</div>';
        if (countEl) countEl.textContent = `${accountHistory.length}件`;
        if (result.hasMore && result.cursor) setupHistoryPagination(result.cursor);
      } catch (error) {
        showError(error);
      }
      return;
    }

    const stored = safeJson(storageKey, []);
    if (!isAuth && type === 'subscriptions') {
      const channels = stored.filter(channel => channel?.id && /^[\w-]{20,}$/.test(String(channel.id)));
      grid.classList.add('channel-library');
      status.hidden = true;
      grid.innerHTML = channels.length ? channels.map(renderChannelCard).join('') : '<div class="library-empty">登録チャンネルはありません</div>';
      if (countEl) countEl.textContent = `${channels.length}件`;
      if (clearBtn) clearBtn.hidden = !channels.length;
      return;
    }

    const ids = stored.map(item => typeof item === 'string' ? item : item?.id).filter(id => /^[\w-]{11}$/.test(String(id || '')));

    if (!ids.length) {
      status.hidden = true;
      grid.innerHTML = `<div class="library-empty">${type === 'history' ? '視聴履歴はありません' : '保存されたアイテムはありません'}</div>`;
      if (clearBtn) clearBtn.hidden = true;
      if (countEl) countEl.textContent = '0件';
      return;
    }

    try {
      const storedVideos = (await fetchJson('/api/videos?ids=' + encodeURIComponent(ids.join(',')))).videos || [];
      status.hidden = true;
      grid.innerHTML = storedVideos.length ? storedVideos.map(renderVideoCard).join('') : '<div class="library-empty">動画を取得できませんでした</div>';
      if (countEl) countEl.textContent = `${storedVideos.length}件`;
    } catch (error) {
      console.error('Library videos:', error);
      status.hidden = true;
      grid.innerHTML = `<div class="library-empty">${esc(error.message || '動画の読み込みに失敗しました')}</div>`;
    }
  }

  function setupHistoryPagination(cursor) {
    historyCursor = cursor;
    historyStatus = document.createElement('div');
    historyStatus.className = 'library-history-more';
    historyStatus.setAttribute('role', 'status');
    historyMessage = document.createElement('span');
    historyStatus.append(historyMessage);
    historyMoreButton = document.createElement('button');
    historyMoreButton.type = 'button';
    historyMoreButton.className = 'yt-text-button';
    historyMoreButton.textContent = '続きを読み込む';
    historyMoreButton.addEventListener('click', () => {
      historyRetryBlocked = false;
      loadMoreHistory();
    });
    historyStatus.append(historyMoreButton);
    grid.insertAdjacentElement('afterend', historyStatus);

    if ('IntersectionObserver' in window) {
      historyObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMoreHistory();
      }, { rootMargin: '600px 0px' });
      historyObserver.observe(historyStatus);
    }
    window.addEventListener('scroll', scheduleHistoryPositionCheck, { passive: true });
    window.addEventListener('resize', scheduleHistoryPositionCheck, { passive: true });
    scheduleHistoryPositionCheck();
  }

  function scheduleHistoryPositionCheck() {
    if (historyCheckScheduled || historyLoading || historyRetryBlocked || !historyCursor || !historyStatus) return;
    historyCheckScheduled = true;
    requestAnimationFrame(() => {
      historyCheckScheduled = false;
      if (historyStatus?.isConnected && historyStatus.getBoundingClientRect().top < window.innerHeight + 600) {
        loadMoreHistory();
      }
    });
  }

  async function loadMoreHistory() {
    if (historyLoading || historyRetryBlocked || !historyCursor) return;
    historyLoading = true;
    historyMoreButton.disabled = true;
    historyMessage.textContent = '読み込み中…';
    try {
      const response = await fetch('/api/account/history/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursor: historyCursor })
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error(`APIからJSON以外の応答が返りました (${response.status})。`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '履歴を追加で読み込めませんでした。');
      if (!result.authenticated || result.source !== 'google-account') {
        throw new Error('Googleアカウントの視聴履歴を取得できませんでした。');
      }
      const existing = new Set($$('.video-card[data-video-id]', grid).map(card => card.dataset.videoId));
      const videos = (result.videos || []).filter(video => {
        if (!video?.id || existing.has(video.id)) return false;
        existing.add(video.id);
        return true;
      });
      if (videos.length) grid.insertAdjacentHTML('beforeend', videos.map(renderVideoCard).join(''));
      historyCursor = result.cursor || '';
      if (countEl) countEl.textContent = `${$$('.video-card[data-video-id]', grid).length}件`;
      if (historyCursor && result.hasMore) {
        historyMessage.textContent = '';
      } else {
        historyCursor = '';
        historyMessage.textContent = '履歴の最後まで読み込みました';
        historyMoreButton.hidden = true;
      }
    } catch (error) {
      historyMessage.textContent = error.message || '履歴を追加で読み込めませんでした。';
      historyMoreButton.textContent = '再試行';
      historyRetryBlocked = true;
    } finally {
      historyLoading = false;
      historyMoreButton.disabled = false;
      scheduleHistoryPositionCheck();
    }
  }

  // Clear library
  clearBtn?.addEventListener('click', () => {
    if (!confirm('本当にすべて削除しますか？')) return;
    localStorage.removeItem(storageKey);
    grid.innerHTML = '<div class="library-empty">削除しました</div>';
    if (countEl) countEl.textContent = '0件';
    clearBtn.hidden = true;
  });

  // Play All
  playAllBtn?.addEventListener('click', async () => {
    const cards = $$('.video-card', grid);
    if (!cards.length) return;
    const ids = cards.map(c => c.dataset.videoId).filter(Boolean);
    if (!ids.length) return;
    const auth = await getAccountAuthStatus();
    if (auth.status === 'signed_out') saveJson('queue', ids.slice(1));
    else if (auth.status !== 'signed_in') {
      notify(auth.error || 'アカウント状態を確認できませんでした。');
      return;
    }
    location.href = `/watch?v=${ids[0]}`;
  });

  // Filter & Search inside Library
  function applyLibraryFilter() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const cards = $$('.video-card, .subscription-card', grid);
    let visible = 0;
    cards.forEach(card => {
      const match = !q || card.textContent.toLowerCase().includes(q);
      card.hidden = !match;
      if (match) visible++;
    });
    if (countEl) countEl.textContent = `${visible}件`;
  }

  searchInput?.addEventListener('input', applyLibraryFilter);

  window.addEventListener('wetube:auth-changed', event => {
    if (event.detail?.signedIn && type === 'history') loadLibraryData();
  });

  loadLibraryData();
})();
