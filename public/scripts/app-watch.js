// --- Watch Page: Player, Autoplay, MiniPlayer, Comments, Shortcuts ---
(() => {
  if (document.body.dataset.page !== 'watch') return;

  const videoId = document.body.dataset.videoId;
  if (!videoId) return;
  const playbackSessionId = newPlaybackSessionId();
  let isAuth = document.body.dataset.authenticated === 'true';
  const isLive = document.body.dataset.live === 'true';

  // Record visits in the app history independently of the embedded player.
  recordHistoryForCurrentAccount(videoId);
  recordAccountWatch(videoId, playbackSessionId);
  const queueAtStart = safeJson('queue', []);
  const remainingQueue = queueAtStart.filter(id => id !== videoId);
  if (remainingQueue.length !== queueAtStart.length) saveJson('queue', remainingQueue);

  // State
  let ytPlayer = null;
  let autoplayTimer = null;
  let isMiniPlayer = false;
  let isCurrentlyPlaying = false;
  let iframePlayerInitRequested = false;
  const playerModeSelect = $('#playerModeSelect');
  const streamPlayer = $('#streamPlayer');
  let currentPlaybackMode = playerModeSelect?.dataset.mode || 'edu:0';
  const playbackSpeed = Number(localStorage.getItem('playbackSpeed') || 1);
  function applyPlaybackSpeed() {
    const speed = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(playbackSpeed) ? playbackSpeed : 1;
    if (currentPlaybackMode === 'stream' && streamPlayer) {
      streamPlayer.playbackRate = speed;
      return;
    }
    try { ytPlayer?.setPlaybackRate?.(speed); } catch (error) {
      console.warn('Set playback speed:', error?.message || error);
    }
  }
  // Initialize YouTube IFrame API integration
  function initIframePlayer() {
    if (iframePlayerInitRequested) return;
    iframePlayerInitRequested = true;
    const iframe = $('#player');
    if (!iframe) return;

    if (window.YT && window.YT.Player) {
      try {
        ytPlayer = new YT.Player('player', {
          events: {
            onReady: onPlayerReady,
            onStateChange: onPlayerStateChange
          }
        });
      } catch (e) {
        console.warn('YT.Player init fallback:', e);
      }
    } else {
      window.onYouTubeIframeAPIReady = () => {
        try {
          ytPlayer = new YT.Player('player', {
            events: {
              onReady: onPlayerReady,
              onStateChange: onPlayerStateChange
            }
          });
        } catch (e) {
          console.warn('YT.Player async init fallback:', e);
        }
      };
    }
  }

  function onPlayerReady() {
    applyPlaybackSpeed();
  }

  // Handle Autoplay on Ended
  function onPlayerStateChange(event) {
    // 0 = YT.PlayerState.ENDED
    if (event.data === 0) {
      isCurrentlyPlaying = false;
      handleVideoEnded();
    } else if (event.data === 1) { // PLAYING
      isCurrentlyPlaying = true;
      updateMiniPlaybackButton(true);
      recordAccountWatch(videoId, playbackSessionId);
      cancelAutoplayCountdown();
    } else if (event.data === 2) {
      isCurrentlyPlaying = false;
      updateMiniPlaybackButton(false);
    }
  }

  // Window postMessage fallback for iframe communication if YT.Player is unavailable
  window.addEventListener('message', event => {
    if (!playerIframe || event.source !== playerIframe.contentWindow) return;
    try {
      if (event.origin !== new URL(playerIframe.src).origin) return;
    } catch {
      return;
    }
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?.event === 'onStateChange' && data.info === 1) {
        isCurrentlyPlaying = true;
        updateMiniPlaybackButton(true);
        recordAccountWatch(videoId, playbackSessionId);
      }
      if (data?.event === 'onStateChange' && data.info === 2) {
        isCurrentlyPlaying = false;
        updateMiniPlaybackButton(false);
      }
      if (data?.event === 'onStateChange' && data.info === 0) {
        isCurrentlyPlaying = false;
        handleVideoEnded();
      }
    } catch {}
  });

  // Autoplay Toggle & Next Video Logic
  const autoToggle = $('#autoplayToggle');
  if (autoToggle) {
    autoToggle.checked = localStorage.getItem('autoplay') !== 'false';
    autoToggle.addEventListener('change', () => {
      localStorage.setItem('autoplay', String(autoToggle.checked));
      notify(autoToggle.checked ? '自動再生をオンにしました' : '自動再生をオフにしました');
      if (!autoToggle.checked) cancelAutoplayCountdown();
    });
  }

  function getNextVideoUrl() {
    const queue = safeJson('queue', []).filter(id => /^[\w-]{11}$/.test(String(id)) && id !== videoId);
    if (queue.length) return { url: `/watch?v=${encodeURIComponent(queue[0])}`, id: queue[0], title: 'キューの次の動画' };
    const firstRelated = $$('.related-card[data-video-id]').find(card => card.dataset.videoId !== videoId);
    const relatedId = firstRelated?.dataset.videoId || '';
    if (!relatedId || !/^[\w-]{11}$/.test(relatedId)) return null;
    return {
      url: firstRelated.href,
      id: relatedId,
      title: firstRelated.querySelector('.related-title')?.textContent || '次の動画'
    };
  }

  function consumeQueuedVideo(id) {
    const queue = safeJson('queue', []);
    const index = queue.indexOf(id);
    if (index >= 0) {
      queue.splice(index, 1);
      saveJson('queue', queue);
    }
  }

  function playNextVideo(next) {
    if (!next?.id || !/^[\w-]{11}$/.test(next.id)) return;
    cancelAutoplayCountdown();
    consumeQueuedVideo(next.id);
    location.href = next.url;
  }

  function handleVideoEnded() {
    if (isLive) return;
    if (localStorage.getItem('autoplay') === 'false') return;
    if (autoplayTimer) return;
    const next = getNextVideoUrl();
    if (!next) return;

    const overlay = $('#autoplayOverlay');
    const titleEl = $('#autoplayNextTitle');
    const countdownEl = $('#autoplayCountdownNum');
    if (!overlay || !countdownEl) return;

    if (titleEl) titleEl.textContent = next.title;
    overlay.hidden = false;
    const ring = $('#ringProgress');
    if (ring) {
      ring.style.animation = 'none';
      void ring.getBoundingClientRect();
      ring.style.animation = '';
    }
    let seconds = 5;
    countdownEl.textContent = String(seconds);
    clearInterval(autoplayTimer);

    autoplayTimer = setInterval(() => {
      seconds--;
      countdownEl.textContent = String(seconds);
      if (seconds <= 0) {
        clearInterval(autoplayTimer);
        autoplayTimer = null;
        if (localStorage.getItem('autoplay') === 'false') return cancelAutoplayCountdown();
        const selected = getNextVideoUrl();
        if (selected) playNextVideo(selected);
      }
    }, 1000);
  }

  function cancelAutoplayCountdown() {
    clearInterval(autoplayTimer);
    autoplayTimer = null;
    const overlay = $('#autoplayOverlay');
    if (overlay) overlay.hidden = true;
  }

  $('#cancelAutoplayBtn')?.addEventListener('click', cancelAutoplayCountdown);
  $('#playNextNowBtn')?.addEventListener('click', () => {
    const next = getNextVideoUrl();
    if (next) playNextVideo(next);
  });

  // Keep the iframe inside its original shell so toggling the mini player
  // changes only the shell's DOM position and does not recreate the player.
  const playerContainer = $('#playerContainer');
  const miniPlayer = $('#miniPlayer');
  const miniSlot = $('#miniPlayerVideoSlot');
  const playerIframe = $('#player');
  const playerShell = $('.player-shell', playerContainer);
  const miniPlayPause = $('#miniPlayerPlayPause');

  function updateMiniPlaybackButton(playing) {
    if (!miniPlayPause) return;
    miniPlayPause.innerHTML = `<svg class="icon"><use href="#i-${playing ? 'pause' : 'play'}"></use></svg>`;
    miniPlayPause.title = playing ? '一時停止' : '再生';
    miniPlayPause.setAttribute('aria-label', playing ? '一時停止' : '再生');
  }

  function sendPlayerCommand(func) {
    const streamPlayer = $('#streamPlayer');
    if (currentPlaybackMode === 'stream' && streamPlayer) {
      if (func === 'pauseVideo') streamPlayer.pause();
      else streamPlayer.play().catch(error => {
        console.warn('Stream playback could not start:', error?.message || error);
      });
      return;
    }
    if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
      if (func === 'pauseVideo') ytPlayer.pauseVideo();
      else ytPlayer.playVideo();
      return;
    }
    try {
      const origin = new URL(playerIframe.src).origin;
      if (!/(^|\.)youtube(?:education)?\.com$/.test(new URL(origin).hostname)) return;
      playerIframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), origin);
    } catch (error) {
      console.warn('Mini player command unavailable:', error?.message || error);
    }
  }

  function toggleMiniPlayer(force) {
    const shouldMini = typeof force === 'boolean' ? force : !isMiniPlayer;
    if (shouldMini === isMiniPlayer) return;
    isMiniPlayer = shouldMini;

    if (isMiniPlayer) {
      if (playerShell && miniSlot) {
        miniSlot.appendChild(playerShell);
        miniPlayer.hidden = false;
        document.body.classList.add('mini-player-active');
      }
    } else {
      if (playerShell && playerContainer) {
        playerContainer.appendChild(playerShell);
        miniPlayer.hidden = true;
        document.body.classList.remove('mini-player-active');
      }
    }
  }

  $('#pipButton')?.addEventListener('click', () => toggleMiniPlayer());
  $('#miniPlayerExpand')?.addEventListener('click', () => toggleMiniPlayer(false));
  $('#miniPlayerTitle')?.addEventListener('click', () => toggleMiniPlayer(false));
  $('#miniPlayerClose')?.addEventListener('click', () => {
    sendPlayerCommand('pauseVideo');
    updateMiniPlaybackButton(false);
    toggleMiniPlayer(false);
  });
  miniPlayPause?.addEventListener('click', () => {
    const playing = currentPlaybackMode === 'stream'
      ? !$('#streamPlayer')?.paused
      : ytPlayer?.getPlayerState?.() === 1;
    sendPlayerCommand(playing ? 'pauseVideo' : 'playVideo');
    if (currentPlaybackMode !== 'stream') updateMiniPlaybackButton(!playing);
  });
  miniPlayer?.querySelector('.mini-player-header')?.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = miniPlayer.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const move = moveEvent => {
      const left = Math.max(0, Math.min(window.innerWidth - miniPlayer.offsetWidth, moveEvent.clientX - offsetX));
      const top = Math.max(0, Math.min(window.innerHeight - miniPlayer.offsetHeight, moveEvent.clientY - offsetY));
      miniPlayer.style.left = `${left}px`;
      miniPlayer.style.top = `${top}px`;
      miniPlayer.style.right = 'auto';
      miniPlayer.style.bottom = 'auto';
    };
    const stop = () => {
      miniPlayer.removeEventListener('pointermove', move);
      miniPlayer.removeEventListener('pointerup', stop);
      miniPlayer.removeEventListener('pointercancel', stop);
    };
    miniPlayer.addEventListener('pointermove', move);
    miniPlayer.addEventListener('pointerup', stop);
    miniPlayer.addEventListener('pointercancel', stop);
  });

  // Description Expand / Collapse
  const descBox = $('#descriptionBox');
  const descToggle = $('#descriptionToggle');
  function toggleDescription() {
    const expanded = descBox.classList.toggle('expanded');
    descToggle.textContent = expanded ? '一部を表示' : 'もっと見る';
    descBox.setAttribute('aria-expanded', String(expanded));
  }
  descToggle?.addEventListener('click', event => {
    event.stopPropagation();
    toggleDescription();
  });
  descBox?.addEventListener('click', event => {
    if (event.target !== descToggle) toggleDescription();
  });
  descBox?.addEventListener('keydown', event => {
    if (event.target === descBox && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      toggleDescription();
    }
  });

  // Subscribe Button
  const subBtn = $('#subscribeButton');
  const channelId = subBtn?.dataset.channelId;

  function updateSubButton(subscribed) {
    if (!subBtn) return;
    subBtn.classList.toggle('subscribed', subscribed);
    subBtn.textContent = subscribed ? '登録済み' : 'チャンネル登録';
  }
  if (subBtn && channelId) {
    subBtn.disabled = true;
    getAccountAuthStatus(true).then(async auth => {
      if (auth.status === 'signed_in') {
        const response = await fetch('/api/account/channel-state?id=' + encodeURIComponent(channelId), { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.authenticated || typeof data.subscribed !== 'boolean') {
          throw new Error(data.error || '登録状態を取得できませんでした。');
        }
        updateSubButton(data.subscribed);
      } else if (auth.status === 'signed_out') {
        const localSubs = safeJson('subscriptions', []);
        updateSubButton(localSubs.some(c => c.id === channelId));
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
          updateSubButton(data.subscribed);
          notify(data.subscribed ? 'チャンネル登録しました' : 'チャンネル登録を解除しました');
        } else if (auth.status === 'signed_out') {
          let list = safeJson('subscriptions', []);
          const joined = list.some(x => x.id === channelId);
          list = joined ? list.filter(x => x.id !== channelId) : [{ id: channelId, name: subBtn.dataset.channelName, avatar: subBtn.dataset.channelAvatar }, ...list];
          saveJson('subscriptions', list);
          updateSubButton(!joined);
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
  }

  // Like & Dislike Buttons
  const likeBtn = $('#likeButton');
  const dislikeBtn = $('#dislikeButton');

  function updateLikeUI(liked) {
    if (likeBtn) likeBtn.classList.toggle('active', liked);
    if (liked && dislikeBtn) dislikeBtn.classList.remove('active');
  }

  function updateDislikeUI(disliked) {
    if (dislikeBtn) dislikeBtn.classList.toggle('active', disliked);
    if (disliked && likeBtn) likeBtn.classList.remove('active');
  }

  if (likeBtn) {
    likeBtn.disabled = true;
    if (dislikeBtn) dislikeBtn.disabled = true;
    getAccountAuthStatus(true).then(async auth => {
      if (!['signed_in', 'signed_out'].includes(auth.status)) {
        throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
      }
      isAuth = auth.status === 'signed_in';
      if (isAuth) {
        const response = await fetch('/api/account/video-state?id=' + encodeURIComponent(videoId), { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.authenticated || typeof data.liked !== 'boolean' || typeof data.disliked !== 'boolean') {
          throw new Error(data.error || '高評価状態を取得できませんでした。');
        }
        updateLikeUI(data.liked);
        updateDislikeUI(data.disliked);
      } else {
        const likedVideos = safeJson('likedVideos', []);
        const dislikedVideos = safeJson('dislikedVideos', []);
        updateLikeUI(likedVideos.includes(videoId));
        updateDislikeUI(dislikedVideos.includes(videoId));
      }
    }).catch(error => {
      console.error('Video rating state:', error);
      notify(error.message || '高評価状態を取得できませんでした。');
    }).finally(() => {
      likeBtn.disabled = false;
      if (dislikeBtn) dislikeBtn.disabled = false;
    });

    likeBtn.addEventListener('click', async () => {
      const active = likeBtn.classList.contains('active');
      likeBtn.disabled = true;
      if (dislikeBtn) dislikeBtn.disabled = true;
      try {
        const auth = await getAccountAuthStatus(true);
        if (!['signed_in', 'signed_out'].includes(auth.status)) {
          throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
        }
        isAuth = auth.status === 'signed_in';
        if (isAuth) {
          const res = await fetch('/api/interact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: active ? 'removeRating' : 'like', videoId })
          });
          const data = await res.json();
          if (!res.ok || data.ok !== true || typeof data.liked !== 'boolean' || typeof data.disliked !== 'boolean') {
            throw new Error(data.error || '操作に失敗しました');
          }
          updateLikeUI(data.liked);
          updateDislikeUI(data.disliked);
          notify(data.liked ? '高評価しました' : '高評価を取り消しました');
        } else {
          let list = safeJson('likedVideos', []);
          list = active ? list.filter(x => x !== videoId) : [videoId, ...list];
          saveJson('likedVideos', list);
          if (!active) saveJson('dislikedVideos', safeJson('dislikedVideos', []).filter(x => x !== videoId));
          updateLikeUI(!active);
          updateDislikeUI(false);
          notify(!active ? '高評価しました' : '高評価を取り消しました');
        }
      } catch (error) {
        notify(error.message || '操作に失敗しました');
      } finally {
        likeBtn.disabled = false;
        if (dislikeBtn) dislikeBtn.disabled = false;
      }
    });

    dislikeBtn?.addEventListener('click', async () => {
      const active = dislikeBtn.classList.contains('active');
      likeBtn.disabled = true;
      dislikeBtn.disabled = true;
      try {
        const auth = await getAccountAuthStatus(true);
        if (!['signed_in', 'signed_out'].includes(auth.status)) {
          throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
        }
        isAuth = auth.status === 'signed_in';
        if (isAuth) {
          const res = await fetch('/api/interact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: active ? 'removeRating' : 'dislike', videoId })
          });
          const data = await res.json();
          if (!res.ok || data.ok !== true || typeof data.liked !== 'boolean' || typeof data.disliked !== 'boolean') {
            throw new Error(data.error || '操作に失敗しました');
          }
          updateLikeUI(data.liked);
          updateDislikeUI(data.disliked);
          notify(data.disliked ? '低評価しました' : '低評価を取り消しました');
        } else {
          const list = safeJson('dislikedVideos', []);
          saveJson('dislikedVideos', active ? list.filter(x => x !== videoId) : [videoId, ...list]);
          if (!active) saveJson('likedVideos', safeJson('likedVideos', []).filter(x => x !== videoId));
          updateDislikeUI(!active);
          updateLikeUI(false);
          notify(!active ? '低評価しました' : '低評価を取り消しました');
        }
      } catch (error) {
        notify(error.message || '操作に失敗しました');
      } finally {
        likeBtn.disabled = false;
        dislikeBtn.disabled = false;
      }
    });
  }

  // Save (Watch Later) Button
  const saveBtn = $('#saveButton');
  if (saveBtn) {
    let saved = false;
    const paintSave = () => {
      saveBtn.classList.toggle('active', saved);
      const label = saved ? '後で見るから削除' : '後で見るに保存';
      saveBtn.title = label;
      saveBtn.setAttribute('aria-label', label);
    };
    saveBtn.disabled = true;
    getAccountAuthStatus(true).then(async auth => {
      isAuth = auth.status === 'signed_in';
      if (isAuth) {
        const response = await fetch(`/api/account/watch-later?videoId=${encodeURIComponent(videoId)}`, { cache:'no-store' });
        const data = await response.json();
        if (!response.ok || !data.authenticated || typeof data.saved !== 'boolean') {
          throw new Error(data.error || 'Googleアカウントの「後で見る」を取得できませんでした。');
        }
        saved = data.saved;
      } else {
        saved = safeJson('watchLater', []).includes(videoId);
      }
      paintSave();
    }).catch(error => {
      console.error('Watch later state:', error);
      notify(error.message || '後で見るの状態を取得できませんでした。');
    }).finally(() => { saveBtn.disabled = false; });
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const auth = await getAccountAuthStatus(true);
        isAuth = auth.status === 'signed_in';
        if (isAuth) {
          const action = saved ? 'remove' : 'add';
          const response = await fetch('/api/account/watch-later', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ action, videoId })
          });
          const data = await response.json();
          if (!response.ok || !data.authenticated || data.ok !== true || typeof data.saved !== 'boolean') {
            throw new Error(data.error || 'Googleアカウントの「後で見る」を更新できませんでした。');
          }
          saved = data.saved;
        } else if (auth.status === 'signed_out') {
          const list = safeJson('watchLater', []);
          saved = !list.includes(videoId);
          saveJson('watchLater', saved ? [videoId, ...list] : list.filter(id => id !== videoId));
        } else {
          throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
        }
        paintSave();
        notify(saved ? '後で見るに保存しました' : '後で見るから削除しました');
      } catch (error) {
        notify(error.message || '後で見るを更新できませんでした。');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // Share Button
  $('#shareButton')?.addEventListener('click', async () => {
    try {
      await navigator.share({ title: document.title, url: location.href });
    } catch {
      await navigator.clipboard.writeText(location.href);
      notify('URLをクリップボードにコピーしました');
    }
  });

  // Theater Mode
  $('#theaterButton')?.addEventListener('click', () => {
    document.body.classList.toggle('theater');
    $('#theaterButton')?.closest('details')?.removeAttribute('open');
  });
  $('#pipButton')?.addEventListener('click', () => {
    $('#pipButton')?.closest('details')?.removeAttribute('open');
  });
  $('#streamInfoButton')?.addEventListener('click', () => {
    $('#streamInfoButton')?.closest('details')?.removeAttribute('open');
  });

  // Player source selector
  let streamRequestId = 0;
  let eduSources = [];
  try { eduSources = JSON.parse(playerModeSelect?.dataset.eduSources || '[]'); } catch {}

  function setIframePlaybackMode(mode) {
    streamRequestId++;
    streamPlayer?.pause();
    if (streamPlayer) {
      streamPlayer.removeAttribute('src');
      streamPlayer.hidden = true;
      streamPlayer.load();
    }
    const iframe = $('#player');
    if (!iframe) return;
    iframe.hidden = false;
    if (mode === 'youtube') {
      iframe.src = playerModeSelect.dataset.youtube;
    } else {
      const index = Math.max(0, Number(mode.split(':')[1]) || 0);
      iframe.src = eduSources[index]?.url || playerModeSelect.dataset.edu;
    }
    currentPlaybackMode = mode;
    initIframePlayer();
    applyPlaybackSpeed();
  }

  async function setStreamPlaybackMode() {
    const requestId = ++streamRequestId;
    const previousMode = currentPlaybackMode;
    sendPlayerCommand('pauseVideo');
    currentPlaybackMode = 'stream';
    const iframe = $('#player');
    if (iframe) {
      iframe.hidden = true;
      iframe.src = 'about:blank';
    }
    if (!streamPlayer) return;
    streamPlayer.hidden = false;
    streamPlayer.removeAttribute('src');
    streamPlayer.load();
    try {
      const response = await fetch(`/api/stream-info?v=${encodeURIComponent(videoId)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.formats)) {
        throw new Error(result.error || 'ストリームを取得できませんでした。');
      }
      if (requestId !== streamRequestId) return;
      const format = result.formats.find(item => {
        if (!item.url || !String(item.mimeType || '').toLowerCase().startsWith('video/mp4')) return false;
        try {
          const url = new URL(item.url);
          return url.protocol === 'https:' && url.hostname.endsWith('googlevideo.com') &&
            (!item.expires || Number(item.expires) * 1000 > Date.now());
        } catch {
          return false;
        }
      });
      if (!format) throw new Error('再生可能なMP4ストリームがありません。');
      streamPlayer.src = format.url;
      streamPlayer.load();
      try {
        await streamPlayer.play();
      } catch (error) {
        if (error?.name !== 'NotAllowedError') throw error;
      }
    } catch (error) {
      if (requestId !== streamRequestId) return;
      console.error('Stream playback:', error?.message || error);
      notify(error.message || 'ストリームを再生できませんでした。');
      currentPlaybackMode = previousMode;
      if (playerModeSelect) playerModeSelect.value = previousMode;
      setIframePlaybackMode(previousMode);
    }
  }

  if (streamPlayer) {
    streamPlayer.addEventListener('play', () => {
      isCurrentlyPlaying = true;
      applyPlaybackSpeed();
      updateMiniPlaybackButton(true);
      recordAccountWatch(videoId, playbackSessionId);
      cancelAutoplayCountdown();
    });
    streamPlayer.addEventListener('pause', () => {
      isCurrentlyPlaying = false;
      updateMiniPlaybackButton(false);
    });
    streamPlayer.addEventListener('ended', () => {
      isCurrentlyPlaying = false;
      handleVideoEnded();
    });
    streamPlayer.addEventListener('error', () => {
      if (currentPlaybackMode === 'stream') notify('ストリームの再生に失敗しました。再生方法を切り替えてください。');
    });
  }
  document.addEventListener('wetube:auth-changed', event => {
    isAuth = Boolean(event.detail?.authenticated);
    if (isAuth && isCurrentlyPlaying) recordAccountWatch(videoId, playbackSessionId);
  });

  if (playerModeSelect) {
    playerModeSelect.addEventListener('change', () => {
      const mode = playerModeSelect.value;
      localStorage.setItem('defaultPlayerMode', mode.startsWith('edu:') ? 'edu' : mode);
      if (mode === 'stream') setStreamPlaybackMode();
      else setIframePlaybackMode(mode);
    });
    const legacyMode = localStorage.getItem('playerMode');
    const preferredMode = localStorage.getItem('defaultPlayerMode') || (legacyMode?.startsWith('edu:') ? 'edu' : legacyMode);
    if (preferredMode) {
      const selectedMode = preferredMode === 'edu'
        ? Array.from(playerModeSelect.options).find(option => option.value.startsWith('edu:'))?.value
        : preferredMode;
      if (selectedMode && Array.from(playerModeSelect.options).some(option => option.value === selectedMode)) {
        playerModeSelect.value = selectedMode;
      }
    }
    if (playerModeSelect.value === 'stream') {
      setStreamPlaybackMode();
    } else {
      setIframePlaybackMode(playerModeSelect.value || currentPlaybackMode);
    }
  }
  streamPlayer?.addEventListener('loadedmetadata', applyPlaybackSpeed);

  // --- Comments Section ---
  const commentsList = $('#commentsList');
  const commentsSection = $('#commentsSection');
  const mobileCommentsOpen = $('#mobileCommentsOpen');
  const mobileCommentsClose = $('#mobileCommentsClose');
  const mobileCommentsScrim = $('#mobileCommentsScrim');
  const commentComposer = $('#commentComposer');
  const commentText = $('#commentText');
  const commentActions = $('#commentComposerActions');
  const submitCommentBtn = $('#submitCommentBtn');
  const cancelCommentBtn = $('#cancelCommentBtn');
  let currentSort = 'top';
  let commentsContinuation = '';
  let commentsHasMore = false;
  let commentsLoading = false;
  let commentsSeen = new Set();
  let commentsSentinel = null;
  let commentsObserver = null;
  let commentsScrollFallback = false;
  let commentsLoaded = false;

  function isMobileWatchLayout() {
    return window.matchMedia('(max-width: 650px)').matches;
  }
  function closeMobileComments({ restoreFocus = false } = {}) {
    document.body.classList.remove('mobile-comments-sheet-open');
    if (mobileCommentsOpen) mobileCommentsOpen.setAttribute('aria-expanded', 'false');
    if (mobileCommentsScrim) mobileCommentsScrim.hidden = true;
    if (restoreFocus) mobileCommentsOpen?.focus();
  }
  function openMobileComments() {
    document.body.classList.add('mobile-comments-sheet-open');
    if (mobileCommentsOpen) mobileCommentsOpen.setAttribute('aria-expanded', 'true');
    if (mobileCommentsScrim) mobileCommentsScrim.hidden = false;
    if (!commentsLoaded) {
      commentsLoaded = true;
      loadComments(currentSort);
    }
    mobileCommentsClose?.focus();
  }
  mobileCommentsOpen?.addEventListener('click', openMobileComments);
  mobileCommentsClose?.addEventListener('click', () => closeMobileComments({ restoreFocus: true }));
  mobileCommentsScrim?.addEventListener('click', () => closeMobileComments({ restoreFocus: true }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('mobile-comments-sheet-open')) {
      event.preventDefault();
      closeMobileComments({ restoreFocus: true });
    }
  });

  function renderComment(comment) {
    const canExpandReplies = comment.replies > 0 && comment.id;
    return `
      <article class="comment-item" data-comment-id="${esc(comment.id || '')}">
        ${comment.avatar ? `<img class="comment-avatar" src="${esc(comment.avatar)}" alt="">` : `<span class="comment-avatar fallback">${esc(comment.author.slice(0, 1))}</span>`}
        <div class="comment-content">
          <div class="comment-meta">
            <b class="comment-author">${esc(comment.author)}</b>
            <small class="comment-time">${esc(comment.published)}</small>
          </div>
          <p class="comment-body">${esc(comment.body)}</p>
          <div class="comment-actions">
            <button class="comment-like-btn" type="button" aria-label="高評価">
              <svg class="icon"><use href="#i-like"></use></svg>
              <span>${esc(comment.likes || '')}</span>
            </button>
            <button class="comment-dislike-btn" type="button" aria-label="低評価">
              <svg class="icon"><use href="#i-dislike"></use></svg>
            </button>
            ${canExpandReplies ? `<button class="comment-reply-btn" type="button" aria-expanded="false" data-comment-id="${esc(comment.id)}">返信 ${comment.replies}</button>` : ''}
          </div>
          ${canExpandReplies ? `<div class="comment-replies" data-replies-for="${esc(comment.id)}" hidden></div>` : ''}
        </div>
      </article>
    `;
  }

  function renderCommentReply(reply) {
    return `
      <article class="comment-reply">
        ${reply.avatar ? `<img class="comment-avatar" src="${esc(reply.avatar)}" alt="">` : `<span class="comment-avatar fallback">${esc(reply.author.slice(0, 1))}</span>`}
        <div class="comment-content">
          <div class="comment-meta">
            <b class="comment-author">${esc(reply.author)}</b>
            <small class="comment-time">${esc(reply.published)}</small>
          </div>
          <p class="comment-body">${esc(reply.body)}</p>
        </div>
      </article>
    `;
  }

  function renderMoreRepliesButton(token) {
    return `<button class="comment-replies-more-btn" type="button" data-continuation-token="${esc(token)}">さらに返信を表示</button>`;
  }

  function checkCommentsPosition() {
    if (commentsHasMore && commentsSentinel?.getBoundingClientRect().top < window.innerHeight + 400) loadNextComments();
  }

  function ensureCommentsSentinel() {
    if (!commentsList) return null;
    if (!commentsSentinel) {
      commentsSentinel = document.createElement('div');
      commentsSentinel.className = 'comments-load-sentinel';
      commentsSentinel.setAttribute('role', 'status');
      commentsSentinel.setAttribute('aria-live', 'polite');
    }
    const newlyAttached = commentsSentinel.parentElement !== commentsList;
    if (newlyAttached) commentsList.append(commentsSentinel);
    if (commentsObserver && newlyAttached) {
      commentsObserver.unobserve(commentsSentinel);
      requestAnimationFrame(() => commentsObserver.observe(commentsSentinel));
    } else if (commentsScrollFallback && newlyAttached) requestAnimationFrame(checkCommentsPosition);
    return commentsSentinel;
  }

  async function loadNextComments() {
    if (!commentsList || !commentsHasMore || !commentsContinuation || commentsLoading) return;
    commentsLoading = true;
    let loadedPage = false;
    const sentinel = ensureCommentsSentinel();
    if (sentinel) sentinel.textContent = 'コメントを読み込み中…';
    try {
      const response = await fetch('/api/comments/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token:commentsContinuation }),
        signal: AbortSignal.timeout(20000),
        cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.comments)) throw new Error(data.error || 'コメントを追加で取得できませんでした。');
      loadedPage = true;
      const comments = data.comments.filter(comment => {
        if (!comment.id || commentsSeen.has(comment.id)) return false;
        commentsSeen.add(comment.id);
        return true;
      });
      if (comments.length && sentinel?.isConnected) {
        sentinel.insertAdjacentHTML('beforebegin', comments.map(renderComment).join(''));
      }
      commentsContinuation = data.continuationToken || '';
      commentsHasMore = Boolean(data.hasMore && commentsContinuation);
      const countHeader = $('#commentsCountHeader');
      if (countHeader && commentsSeen.size) countHeader.textContent = `コメント ${commentsSeen.size} 件`;
      if (sentinel) sentinel.textContent = '';
      if (!commentsHasMore && sentinel) {
        commentsObserver?.unobserve(sentinel);
        sentinel.remove();
        commentsSentinel = null;
      }
      if (commentsHasMore && sentinel && commentsObserver) {
        commentsObserver.unobserve(sentinel);
        requestAnimationFrame(() => commentsObserver.observe(sentinel));
      }
    } catch (error) {
      if (sentinel) sentinel.textContent = error.message || 'コメントを追加で取得できませんでした。';
    } finally {
      commentsLoading = false;
      if (loadedPage && commentsHasMore && !commentsObserver) requestAnimationFrame(checkCommentsPosition);
    }
  }

  async function loadComments(sort = 'top') {
    if (!commentsList) return;
    commentsObserver?.disconnect();
    commentsContinuation = '';
    commentsHasMore = false;
    commentsLoading = false;
    commentsSeen = new Set();
    commentsSentinel = null;
    commentsList.innerHTML = '<div class="comments-loading">コメントを読み込み中…</div>';
    try {
      const response = await fetch(`/api/comments?v=${encodeURIComponent(videoId)}&sort=${sort}`, {
        signal: AbortSignal.timeout(20000),
        cache: 'no-store'
      });
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('コメントを取得できませんでした。ページを再読み込みしてください。');
      }
      const res = await response.json();
      if (!response.ok || !Array.isArray(res.comments)) throw new Error(res.error || 'コメントを取得できませんでした。');
      const comments = res.comments.filter(comment => {
        if (!comment.id || commentsSeen.has(comment.id)) return false;
        commentsSeen.add(comment.id);
        return true;
      });
      const countHeader = $('#commentsCountHeader');
      if (countHeader) countHeader.textContent = comments.length ? `コメント ${comments.length} 件` : 'コメント';
      if (mobileCommentsOpen) {
        const label = mobileCommentsOpen.querySelector('span');
        if (label && comments.length) label.textContent = `コメント ${comments.length} 件を表示`;
      }

      commentsContinuation = res.continuationToken || '';
      commentsHasMore = Boolean(res.hasMore && commentsContinuation);
      if (!comments.length && !commentsHasMore) {
        commentsList.innerHTML = '<div class="comments-empty">コメントはありません</div>';
        return;
      }

      commentsList.innerHTML = comments.map(renderComment).join('');
      if (commentsHasMore) {
        const sentinel = ensureCommentsSentinel();
        if (sentinel) sentinel.textContent = '';
      }
    } catch (error) {
      commentsLoaded = false;
      commentsList.innerHTML = `<div class="comments-empty">${esc(error.message || 'コメントを読み込めませんでした')}</div>`;
    }
  }

  commentsList?.addEventListener('click', async event => {
    const button = event.target.closest('.comment-reply-btn, .comment-replies-more-btn');
    if (!button || button.disabled) return;
    const loadMore = button.matches('.comment-replies-more-btn');
    const commentItem = button.closest('.comment-item');
    const commentId = button.dataset.commentId || commentItem?.dataset.commentId;
    const panel = button.closest('.comment-content')?.querySelector('.comment-replies');
    if (!commentId || !panel) return;
    if (loadMore) {
      button.disabled = true;
      try {
        const params = new URLSearchParams({ v:videoId, commentId, continuation:button.dataset.continuationToken || '' });
        const response = await fetch(`/api/comment-replies?${params}`);
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.replies)) throw new Error(data.error || '返信を取得できませんでした。');
        button.remove();
        panel.insertAdjacentHTML('beforeend', data.replies.map(renderCommentReply).join(''));
        if (data.continuationToken) panel.insertAdjacentHTML('beforeend', renderMoreRepliesButton(data.continuationToken));
      } catch (error) {
        button.insertAdjacentHTML('beforebegin', `<p class="comment-replies-error">${esc(error.message || '返信を読み込めませんでした')}</p>`);
        button.disabled = false;
      }
      return;
    }
    if (button.getAttribute('aria-expanded') === 'true') {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    button.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    if (panel.dataset.loaded === 'true') return;
    button.disabled = true;
    panel.innerHTML = '<p class="comment-replies-loading">返信を読み込み中…</p>';
    try {
      const response = await fetch(`/api/comment-replies?v=${encodeURIComponent(videoId)}&commentId=${encodeURIComponent(commentId)}&sort=${encodeURIComponent(currentSort)}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.replies)) throw new Error(data.error || '返信を取得できませんでした。');
      panel.innerHTML = data.replies.map(renderCommentReply).join('') || '<p class="comment-replies-empty">返信はありません</p>';
      if (data.continuationToken) panel.insertAdjacentHTML('beforeend', renderMoreRepliesButton(data.continuationToken));
      panel.dataset.loaded = 'true';
    } catch (error) {
      panel.innerHTML = `<p class="comment-replies-error">${esc(error.message || '返信を読み込めませんでした')}</p>`;
    } finally {
      button.disabled = false;
    }
  });

  // Comment Composer Expand
  commentText?.addEventListener('focus', () => {
    if (commentActions) commentActions.hidden = false;
  });

  commentText?.addEventListener('input', () => {
    if (submitCommentBtn) {
      submitCommentBtn.disabled = !commentText.value.trim();
    }
  });

  cancelCommentBtn?.addEventListener('click', () => {
    commentText.value = '';
    commentText.blur();
    if (commentActions) commentActions.hidden = true;
  });

  commentComposer?.addEventListener('submit', async e => {
    e.preventDefault();
    const text = commentText.value.trim();
    if (!text) return;
    submitCommentBtn.disabled = true;
    try {
      const res = await fetch('/api/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'comment', videoId, text })
      });
      const data = await res.json();
      if (!res.ok || data.ok !== true) throw new Error(data.error || 'コメントに失敗しました');
      commentText.value = '';
      if (commentActions) commentActions.hidden = true;
      notify('コメントを投稿しました');
      await loadComments(currentSort);
    } catch (err) {
      notify(err.message || 'コメントできませんでした');
    } finally {
      submitCommentBtn.disabled = false;
    }
  });

  // Sort Dropdown
  const sortBtn = $('#commentsSortBtn');
  const sortMenu = $('#commentsSortMenu');
  sortBtn?.addEventListener('click', e => {
    e.stopPropagation();
    sortMenu.hidden = !sortMenu.hidden;
  });

  sortMenu?.querySelectorAll('button[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      sortMenu.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sortMenu.hidden = true;
      currentSort = btn.dataset.sort;
      $('#commentsSortLabel').textContent = btn.textContent;
      loadComments(currentSort);
    });
  });

  document.addEventListener('click', () => {
    if (sortMenu) sortMenu.hidden = true;
  });

  // Defer mobile comments until the user opens the comments sheet.
  if (commentsList && 'IntersectionObserver' in window) {
    commentsObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadNextComments();
    }, { rootMargin:'400px 0px' });
  } else if (commentsList) {
    commentsScrollFallback = true;
    window.addEventListener('scroll', checkCommentsPosition, { passive:true });
    window.addEventListener('resize', checkCommentsPosition, { passive:true });
  }
  if (!isMobileWatchLayout()) {
    commentsLoaded = true;
    loadComments('top');
  }

  // Stream Info Dialog
  const streamBtn = $('#streamInfoButton');
  const streamDialog = $('#streamInfoDialog');
  const streamList = $('#streamInfoList');
  streamBtn?.addEventListener('click', async () => {
    if (streamDialog) streamDialog.hidden = false;
    if (streamList) streamList.innerHTML = '<p class="muted">ストリーム情報を取得しています…</p>';
    try {
      const res = await fetch(`/api/stream-info?v=${encodeURIComponent(videoId)}`).then(r => r.json());
      if (res.error) throw new Error(res.error);
      const titleEl = $('#streamVideoTitle');
      if (titleEl) {
        titleEl.textContent = res.title || '';
        titleEl.hidden = !res.title;
      }
      streamList.innerHTML = (res.formats || []).map((f, index) => {
        const mime = f.mimeType || '';
        const isAudio = mime.startsWith('audio/');
        const quality = f.quality || (isAudio ? '音声' : '動画');
        const details = [
          f.fps ? `${f.fps}fps` : '',
          f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps` : ''
        ].filter(Boolean).join(' · ');
        return `
          <article class="stream-format">
            <div class="stream-format-badge">${isAudio ? '♫' : 'HD'}</div>
            <div class="stream-format-meta">
              <strong>${esc(quality)}</strong>
              <span>${esc(isAudio ? '音声' : '動画')} · ${esc(mime.split('/')[1] || mime)}</span>
              ${details ? `<small>${esc(details)}</small>` : ''}
            </div>
            ${f.url ? `<a class="stream-download" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" download aria-label="${esc(quality)}をダウンロード"><span>ダウンロード</span><b>↓</b></a>` : ''}
          </article>
        `;
      }).join('') || '<div class="stream-empty"><span>!</span><p>利用可能な形式がありません</p></div>';
    } catch (e) {
      streamList.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  });
  streamDialog?.querySelector('.modal-close')?.addEventListener('click', () => {
    streamDialog.hidden = true;
  });

  // --- Keyboard Shortcuts Controller ---
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' && isShortcutBlocked(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();

    // / -> Focus Search
    if (key === '/') {
      e.preventDefault();
      $('#searchInput')?.focus();
      return;
    }

    // t -> Theater Mode
    if (key === 't') {
      e.preventDefault();
      $('#theaterButton')?.click();
      return;
    }

    // i -> Mini Player
    if (key === 'i') {
      e.preventDefault();
      toggleMiniPlayer();
      return;
    }

    // f -> Fullscreen
    if (key === 'f') {
      e.preventDefault();
      const shell = $('.player-shell');
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        shell?.requestFullscreen?.();
      }
      return;
    }

    if (currentPlaybackMode === 'stream' && streamPlayer) {
      if (key === 'k' || e.code === 'Space') {
        e.preventDefault();
        if (streamPlayer.paused) streamPlayer.play().catch(error => notify(error.message || '再生できませんでした。'));
        else streamPlayer.pause();
        return;
      }
      if (key === 'j' || key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const amount = key === 'j' ? -10 : key === 'l' ? 10 : e.key === 'ArrowLeft' ? -5 : 5;
        streamPlayer.currentTime = Math.max(0, Math.min(streamPlayer.duration || Infinity, streamPlayer.currentTime + amount));
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        streamPlayer.volume = Math.max(0, Math.min(1, streamPlayer.volume + (e.key === 'ArrowUp' ? 0.05 : -0.05)));
        return;
      }
      if (key === 'm') {
        e.preventDefault();
        streamPlayer.muted = !streamPlayer.muted;
        return;
      }
      if (/^[0-9]$/.test(e.key) && Number.isFinite(streamPlayer.duration)) {
        e.preventDefault();
        streamPlayer.currentTime = streamPlayer.duration * Number(e.key) / 10;
        return;
      }
    }

    // Player controls via YT API or postMessage
    if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
      try {
        if (key === 'k' || e.code === 'Space') {
          e.preventDefault();
          const state = ytPlayer.getPlayerState();
          if (state === 1) ytPlayer.pauseVideo();
          else ytPlayer.playVideo();
        } else if (key === 'j') {
          e.preventDefault();
          ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() - 10), true);
          notify('-10秒');
        } else if (key === 'l') {
          e.preventDefault();
          ytPlayer.seekTo(ytPlayer.getCurrentTime() + 10, true);
          notify('+10秒');
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() - 5), true);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          ytPlayer.seekTo(ytPlayer.getCurrentTime() + 5, true);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          ytPlayer.setVolume(Math.min(100, ytPlayer.getVolume() + 5));
          notify(`音量: ${ytPlayer.getVolume()}%`);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          ytPlayer.setVolume(Math.max(0, ytPlayer.getVolume() - 5));
          notify(`音量: ${ytPlayer.getVolume()}%`);
        } else if (key === 'm') {
          e.preventDefault();
          if (ytPlayer.isMuted()) {
            ytPlayer.unMute();
            notify('ミュート解除');
          } else {
            ytPlayer.mute();
            notify('ミュート');
          }
        } else if (e.key >= '0' && e.key <= '9') {
          e.preventDefault();
          const dur = ytPlayer.getDuration();
          if (dur) {
            ytPlayer.seekTo(dur * (Number(e.key) / 10), true);
          }
        } else if (!e.shiftKey && (key === ',' || key === '.')) {
          e.preventDefault();
          const step = key === ',' ? -1 / 30 : 1 / 30;
          ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() + step), true);
        } else if (e.shiftKey && (e.key === '>' || e.key === '.')) {
          e.preventDefault();
          const rates = ytPlayer.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
          const curr = ytPlayer.getPlaybackRate?.() || 1;
          const next = rates.find(r => r > curr) || rates[rates.length - 1];
          ytPlayer.setPlaybackRate(next);
          notify(`再生速度: ${next}x`);
        } else if (e.shiftKey && (e.key === '<' || e.key === ',')) {
          e.preventDefault();
          const rates = (ytPlayer.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]).slice().reverse();
          const curr = ytPlayer.getPlaybackRate?.() || 1;
          const prev = rates.find(r => r < curr) || rates[rates.length - 1];
          ytPlayer.setPlaybackRate(prev);
          notify(`再生速度: ${prev}x`);
        } else if (key === 'c') {
          e.preventDefault();
          const options = ytPlayer.getOptions?.() || [];
          const tracks = options.includes('captions') ? ytPlayer.getOption?.('captions', 'tracklist') || [] : [];
          if (!tracks.length) {
            notify('字幕を利用できません');
          } else if (ytPlayer.getOption?.('captions', 'track')?.languageCode) {
            ytPlayer.setOption('captions', 'track', {});
            notify('字幕をオフにしました');
          } else {
            const preferred = tracks.find(track => track.languageCode === 'ja') || tracks[0];
            ytPlayer.setOption('captions', 'track', preferred);
            notify('字幕をオンにしました');
          }
        } else if (e.shiftKey && key === 'n') {
          e.preventDefault();
          const next = getNextVideoUrl();
          if (next) playNextVideo(next);
        } else if (e.shiftKey && key === 'p') {
          e.preventDefault();
          try {
            const previous = new URL(document.referrer);
            if (previous.origin === location.origin && previous.pathname === '/watch' && previous.searchParams.get('v') !== videoId) history.back();
          } catch {}
        }
      } catch (err) {
        console.warn('Player shortcut error:', err);
      }
    }
  });

  if (currentPlaybackMode !== 'stream') initIframePlayer();

  const liveChatPanel = $('#liveChatPanel');
  const liveChatMessages = $('#liveChatMessages');
  const liveChatStatus = $('#liveChatStatus');
  const liveChatFilter = $('#liveChatFilter');
  const liveChatReplayToggle = $('#liveChatReplayToggle');
  const liveChatMode = document.body.dataset.liveChatMode || 'none';
  const liveChatReplay = liveChatMode === 'replay';
  if (isLive && liveChatPanel && playerShell && 'ResizeObserver' in window) {
    const syncLiveChatHeight = () => {
      const playerHeight = playerShell.getBoundingClientRect().height;
      if (playerHeight > 0) liveChatPanel.style.height = `${Math.round(playerHeight)}px`;
    };
    new ResizeObserver(syncLiveChatHeight).observe(playerShell);
    syncLiveChatHeight();
  }
  if (liveChatPanel && liveChatMessages && (isLive || liveChatReplay)) {
    let liveChatToken = '';
    let liveChatStarted = false;
    const syncChatHeight = () => {
      const playerHeight = playerShell?.getBoundingClientRect().height || 0;
      if (playerHeight > 0) liveChatPanel.style.height = `${Math.round(playerHeight)}px`;
    };
    const setLiveChatStatus = (message, state = '') => {
      if (!liveChatStatus) return;
      liveChatStatus.textContent = message;
      liveChatStatus.dataset.state = state;
    };
    const renderLiveChatMessage = message => {
      const atBottom = liveChatMessages.scrollHeight - liveChatMessages.scrollTop - liveChatMessages.clientHeight < 80;
      liveChatMessages.querySelector('.live-chat-placeholder')?.remove();
      const row = document.createElement('li');
      row.className = `live-chat-message${message.type === 'LiveChatPaidMessage' || message.type === 'LiveChatPaidSticker' ? ' is-paid' : ''}`;
      row.dataset.messageId = message.id;
      if (message.avatar) {
        const avatar = document.createElement('img');
        avatar.className = 'live-chat-avatar';
        avatar.src = message.avatar;
        avatar.alt = '';
        avatar.loading = 'lazy';
        avatar.referrerPolicy = 'no-referrer';
        row.append(avatar);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'live-chat-avatar-fallback';
        fallback.textContent = message.author.slice(0, 1) || '•';
        row.append(fallback);
      }
      const content = document.createElement('div');
      content.className = 'live-chat-message-content';
      const meta = document.createElement('div');
      meta.className = 'live-chat-message-meta';
      const author = document.createElement('span');
      author.className = 'live-chat-author';
      author.textContent = message.author;
      meta.append(author);
      if (message.owner || message.moderator || message.verified) {
        const badge = document.createElement('span');
        badge.className = 'live-chat-badge';
        badge.textContent = message.owner ? '配信者' : message.moderator ? 'モデレーター' : '認証済み';
        meta.append(badge);
      }
      const timestamp = Number(message.timestamp);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        const time = document.createElement('time');
        time.className = 'live-chat-time';
        time.dateTime = new Date(timestamp).toISOString();
        time.textContent = new Date(timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        meta.append(time);
      }
      content.append(meta);
      if (message.text) {
        const text = document.createElement('div');
        text.className = 'live-chat-text';
        text.textContent = message.text;
        content.append(text);
      }
      if (message.amount) {
        const amount = document.createElement('span');
        amount.className = 'live-chat-amount';
        amount.textContent = message.amount;
        content.append(amount);
      }
      if (message.sticker) {
        const sticker = document.createElement('img');
        sticker.className = 'live-chat-sticker';
        sticker.src = message.sticker;
        sticker.alt = 'ステッカー';
        sticker.loading = 'lazy';
        content.append(sticker);
      }
      row.append(content);
      liveChatMessages.append(row);
      while (liveChatMessages.children.length > 150) liveChatMessages.firstElementChild.remove();
      if (atBottom) liveChatMessages.scrollTop = liveChatMessages.scrollHeight;
    };
    const handleLiveChatEvent = event => {
      let data;
      try { data = JSON.parse(event.data); } catch (error) {
        console.warn('Invalid live chat event:', error);
        return;
      }
      if (data.kind === 'status') {
        const labels = {
          connecting: '接続中…',
          connected: '接続しました',
          error: data.message || 'チャットでエラーが発生しました',
          ended: data.message || '配信が終了しました'
        };
        setLiveChatStatus(labels[data.status] || '接続中…', data.status);
      } else if (data.kind === 'message') {
        renderLiveChatMessage(data);
      } else if (data.kind === 'delete') {
        const deleted = liveChatMessages.querySelector(`[data-message-id="${CSS.escape(data.id)}"]`);
        if (deleted) deleted.textContent = 'メッセージが削除されました';
      }
    };

    const startLiveChat = async () => {
      if (liveChatStarted) return;
      liveChatStarted = true;
      try {
        const response = await fetch(`/api/live-chat/start?v=${encodeURIComponent(videoId)}`, { method: 'POST', cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.token) throw new Error(result.error || 'ライブチャットを開始できませんでした。');
        liveChatToken = result.token;
        const stream = new EventSource(`/api/live-chat/${encodeURIComponent(liveChatToken)}/events`);
        stream.onmessage = handleLiveChatEvent;
        stream.onerror = () => setLiveChatStatus('再接続中…', 'connecting');
      } catch (error) {
        liveChatStarted = false;
        setLiveChatStatus(error.message || '接続できませんでした', 'error');
        console.warn('Live chat:', error?.message || error);
      }
    };

    liveChatReplayToggle?.addEventListener('click', () => {
      const isVisible = !liveChatPanel.hidden;
      liveChatPanel.hidden = isVisible;
      liveChatReplayToggle.setAttribute('aria-expanded', String(!isVisible));
      liveChatReplayToggle.textContent = isVisible ? 'チャットのリプレイを表示' : 'チャットのリプレイを隠す';
      if (!isVisible) {
        syncChatHeight();
        startLiveChat();
      }
    });

    liveChatFilter?.addEventListener('change', async () => {
      if (!liveChatToken) return;
      try {
        const filtered = await fetch(`/api/live-chat/${encodeURIComponent(liveChatToken)}/filter`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter: liveChatFilter.value })
        });
        const result = await filtered.json();
        if (!filtered.ok) throw new Error(result.error || '表示を切り替えられませんでした。');
      } catch (error) {
        console.warn('Live chat filter:', error?.message || error);
        notify(error.message || 'チャット表示を切り替えられませんでした。');
      }
    });

    if (isLive) startLiveChat();
  }
})();
