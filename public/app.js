/**
 * YouTube Web Client - Core Application JavaScript
 * Fully aligned with official YouTube UI, UX, and interactions.
 */

// --- Utilities ---
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeJson = (key, fallback = []) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
const saveJson = (key, val) => localStorage.setItem(key, JSON.stringify(val));

const toast = $('#toast');
function notify(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// --- Theme Management (Device / Dark / Light) ---
(() => {
  const root = document.documentElement;
  const themePref = localStorage.getItem('themePreference') || 'dark';
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(pref) {
    let activeTheme = pref;
    if (pref === 'device') {
      activeTheme = systemDark.matches ? 'dark' : 'light';
    }
    root.dataset.theme = activeTheme;
    const label = $('#currentThemeLabel');
    if (label) {
      label.textContent = pref === 'device' ? '端末の設定' : pref === 'dark' ? 'ダーク' : 'ライト';
    }
    const radios = $$('input[name="themeSelect"]');
    radios.forEach(r => { r.checked = r.value === pref; });
  }

  systemDark.addEventListener('change', () => {
    if ((localStorage.getItem('themePreference') || 'device') === 'device') {
      applyTheme('device');
    }
  });

  applyTheme(themePref);

  // Theme dialog interactions
  const themeDialog = $('#themeDialog');
  $('#themeMenuTrigger')?.addEventListener('click', () => {
    $('#accountMenuPopover')?.setAttribute('hidden', '');
    if (themeDialog) themeDialog.hidden = false;
  });

  themeDialog?.querySelectorAll('input[name="themeSelect"]').forEach(input => {
    input.addEventListener('change', e => {
      const selected = e.target.value;
      localStorage.setItem('themePreference', selected);
      applyTheme(selected);
      setTimeout(() => { if (themeDialog) themeDialog.hidden = true; }, 180);
    });
  });

  themeDialog?.querySelector('.modal-close')?.addEventListener('click', () => {
    themeDialog.hidden = true;
  });
})();

// --- Header Interactions: Menu, Search, Popovers ---
(() => {
  const body = document.body;
  const isMobile = () => window.matchMedia('(max-width: 650px)').matches;

  // Hamburger Menu
  $('#menuButton')?.addEventListener('click', () => {
    if (body.dataset.page === 'watch') {
      body.classList.toggle('watch-sidebar-open');
    } else if (isMobile()) {
      body.classList.toggle('mobile-menu-open');
    } else {
      body.classList.toggle('menu-collapsed');
    }
  });

  $('#scrim')?.addEventListener('click', () => {
    body.classList.remove('mobile-menu-open', 'watch-sidebar-open');
  });

  // Topbar scroll shadow
  window.addEventListener('scroll', () => {
    $('.topbar')?.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });

  // Popover manager: close when clicking outside
  const popovers = [$('#notificationsPopover'), $('#accountMenuPopover'), $('#cardActionMenu')].filter(Boolean);
  function closeAllPopovers(except = null) {
    popovers.forEach(p => {
      if (p !== except && !p.hidden) p.hidden = true;
    });
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.popover-anchor') && !e.target.closest('.card-action-menu') && !e.target.closest('.more-btn')) {
      closeAllPopovers();
    }
  });

  // Notifications Popover
  const notifBtn = $('#notificationsButton');
  const notifPopover = $('#notificationsPopover');
  const notifList = $('#notificationsList');
  let notifsLoaded = false;

  notifBtn?.addEventListener('click', async e => {
    e.stopPropagation();
    const willOpen = notifPopover.hidden;
    closeAllPopovers(willOpen ? notifPopover : null);
    notifPopover.hidden = !willOpen;

    if (willOpen && !notifsLoaded) {
      notifList.innerHTML = '<div class="popover-loading">読み込み中…</div>';
      try {
        const res = await fetch('/api/notifications').then(r => r.json());
        const items = res.notifications || [];
        if (!items.length) {
          notifList.innerHTML = '<div class="popover-empty">新しい通知はありません</div>';
        } else {
          notifList.innerHTML = items.map(n => `
            <a class="notif-item" href="${esc(n.url)}">
              <div class="notif-avatar-wrap">
                ${n.authorThumbnail ? `<img class="notif-avatar" src="${esc(n.authorThumbnail)}" alt="">` : `<span class="notif-avatar fallback">${esc(n.author.slice(0, 1))}</span>`}
              </div>
              <div class="notif-copy">
                <b>${esc(n.author)}</b>
                <p>${esc(n.title)}</p>
                <small>${esc(n.published)}</small>
              </div>
              <img class="notif-thumb" src="${esc(n.thumbnail)}" alt="">
            </a>
          `).join('');
        }
        notifsLoaded = true;
      } catch {
        notifList.innerHTML = '<div class="popover-empty">通知を取得できませんでした</div>';
      }
    }
  });

  $('#closeNotifPopover')?.addEventListener('click', () => {
    if (notifPopover) notifPopover.hidden = true;
  });

  // Account Dropdown Menu Popover
  const accountBtn = $('#accountButton');
  const accountPopover = $('#accountMenuPopover');
  accountBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = accountPopover.hidden;
    closeAllPopovers(willOpen ? accountPopover : null);
    accountPopover.hidden = !willOpen;
  });

  // Shortcuts Dialog
  const shortcutsDialog = $('#shortcutsDialog');
  $('#shortcutsMenuTrigger')?.addEventListener('click', () => {
    accountPopover.hidden = true;
    if (shortcutsDialog) shortcutsDialog.hidden = false;
  });
  shortcutsDialog?.querySelector('.modal-close')?.addEventListener('click', () => {
    shortcutsDialog.hidden = true;
  });

  // Auth Dialog trigger from Account Menu
  const authDialog = $('#authDialog');
  $('#authMenuAction')?.addEventListener('click', () => {
    accountPopover.hidden = true;
    if (body.dataset.authenticated === 'true') {
      $('#signOutButton')?.click();
    } else if (authDialog) {
      authDialog.hidden = false;
    }
  });

  // --- Rich Search Bar & Dropdown Suggestions ---
  const searchInput = $('#searchInput');
  const searchClear = $('#searchClear');
  const searchSuggestions = $('#searchSuggestions');
  let suggestTimer = null;
  let activeIndex = -1;

  function getSearchHistory() {
    return safeJson('searchHistory', []);
  }

  function renderSuggestions(query = '', suggestions = []) {
    const history = getSearchHistory().filter(h => !query || h.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
    const apiItems = suggestions.filter(s => !history.includes(s)).slice(0, 7);

    if (!history.length && !apiItems.length) {
      searchSuggestions.hidden = true;
      searchSuggestions.innerHTML = '';
      return;
    }

    let html = '';
    history.forEach(item => {
      html += `
        <div class="suggestion-item is-history" data-query="${esc(item)}">
          <svg class="icon"><use href="#i-clock"></use></svg>
          <span class="suggestion-text">${esc(item)}</span>
          <button type="button" class="del-history-btn" data-del="${esc(item)}" aria-label="履歴から削除">削除</button>
        </div>
      `;
    });
    apiItems.forEach(item => {
      html += `
        <div class="suggestion-item" data-query="${esc(item)}">
          <svg class="icon"><use href="#i-search"></use></svg>
          <span class="suggestion-text">${esc(item)}</span>
        </div>
      `;
    });

    searchSuggestions.innerHTML = html;
    searchSuggestions.hidden = false;
    activeIndex = -1;
  }

  searchInput?.addEventListener('input', () => {
    const val = searchInput.value;
    searchClear.hidden = !val;
    clearTimeout(suggestTimer);
    if (!val.trim()) {
      renderSuggestions('');
      return;
    }
    suggestTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/suggestions?q=' + encodeURIComponent(val.trim())).then(r => r.json());
        renderSuggestions(val.trim(), res.suggestions || []);
      } catch {
        renderSuggestions(val.trim(), []);
      }
    }, 150);
  });

  searchInput?.addEventListener('focus', () => {
    const val = searchInput.value;
    searchClear.hidden = !val;
    if (!val.trim()) {
      renderSuggestions('');
    } else {
      searchInput.dispatchEvent(new Event('input'));
    }
  });

  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    searchInput.focus();
    renderSuggestions('');
  });

  // Keyboard navigation inside search suggestions
  searchInput?.addEventListener('keydown', e => {
    const items = $$('.suggestion-item', searchSuggestions);
    if (!items.length || searchSuggestions.hidden) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      updateHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      updateHighlight(items);
    } else if (e.key === 'Escape') {
      searchSuggestions.hidden = true;
    }
  });

  function updateHighlight(items) {
    items.forEach((item, idx) => {
      const active = idx === activeIndex;
      item.classList.toggle('highlighted', active);
      if (active) {
        searchInput.value = item.dataset.query;
      }
    });
  }

  searchSuggestions?.addEventListener('click', e => {
    const delBtn = e.target.closest('.del-history-btn');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const target = delBtn.dataset.del;
      const history = getSearchHistory().filter(h => h !== target);
      saveJson('searchHistory', history);
      delBtn.closest('.suggestion-item')?.remove();
      if (!searchSuggestions.children.length) searchSuggestions.hidden = true;
      return;
    }
    const item = e.target.closest('.suggestion-item');
    if (item && item.dataset.query) {
      searchInput.value = item.dataset.query;
      searchSuggestions.hidden = true;
      searchInput.closest('form')?.submit();
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) {
      if (searchSuggestions) searchSuggestions.hidden = true;
    }
  });

  // Save query to search history on form submit
  document.querySelector('.search-form')?.addEventListener('submit', () => {
    const q = searchInput?.value.trim();
    if (q) {
      const history = [q, ...getSearchHistory().filter(x => x !== q)].slice(0, 20);
      saveJson('searchHistory', history);
    }
  });
})();

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

  $('#cardActionQueue')?.addEventListener('click', () => {
    menu.hidden = true;
    if (!activeVideoId) return;
    const q = safeJson('queue', []).filter(x => x !== activeVideoId);
    q.push(activeVideoId);
    saveJson('queue', q);
    notify('キューに追加しました');
  });

  $('#cardActionSave')?.addEventListener('click', () => {
    menu.hidden = true;
    if (!activeVideoId) return;
    let list = safeJson('watchLater', []);
    const exists = list.includes(activeVideoId);
    list = exists ? list.filter(x => x !== activeVideoId) : [activeVideoId, ...list];
    saveJson('watchLater', list.slice(0, 100));
    notify(exists ? '後で見るから削除しました' : '後で見るに保存しました');
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

// --- Watch Page: Player, Autoplay, MiniPlayer, Comments, Shortcuts ---
(() => {
  if (document.body.dataset.page !== 'watch') return;

  const videoId = document.body.dataset.videoId;
  if (!videoId) return;

  // Add to watch history
  const history = safeJson('history', []).filter(x => x !== videoId);
  saveJson('history', [videoId, ...history].slice(0, 50));

  // State
  let ytPlayer = null;
  let autoplayTimer = null;
  let isMiniPlayer = false;

  // Initialize YouTube IFrame API integration
  function initIframePlayer() {
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
    // Player is interactive
  }

  // Handle Autoplay on Ended
  function onPlayerStateChange(event) {
    // 0 = YT.PlayerState.ENDED
    if (event.data === 0) {
      handleVideoEnded();
    } else if (event.data === 1) { // PLAYING
      cancelAutoplayCountdown();
    }
  }

  // Window postMessage fallback for iframe communication if YT.Player is unavailable
  window.addEventListener('message', event => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?.event === 'onStateChange' && data.info === 0) {
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
    // Priority: Queue first, else first related video
    const queue = safeJson('queue', []);
    if (queue.length) {
      const nextId = queue[0];
      return { url: `/watch?v=${nextId}`, id: nextId, title: 'キューの次の動画' };
    }
    const firstRelated = $('.related-card');
    if (firstRelated) {
      return {
        url: firstRelated.href,
        id: firstRelated.dataset.videoId,
        title: firstRelated.querySelector('.related-title')?.textContent || '次の動画'
      };
    }
    return null;
  }

  function handleVideoEnded() {
    if (localStorage.getItem('autoplay') === 'false') return;
    const next = getNextVideoUrl();
    if (!next) return;

    const overlay = $('#autoplayOverlay');
    const titleEl = $('#autoplayNextTitle');
    const countdownEl = $('#autoplayCountdownNum');
    if (!overlay || !countdownEl) return;

    if (titleEl) titleEl.textContent = next.title;
    overlay.hidden = false;

    let seconds = 5;
    countdownEl.textContent = String(seconds);
    clearInterval(autoplayTimer);

    autoplayTimer = setInterval(() => {
      seconds--;
      countdownEl.textContent = String(seconds);
      if (seconds <= 0) {
        clearInterval(autoplayTimer);
        // Pop queue if applicable
        const queue = safeJson('queue', []);
        if (queue.length && queue[0] === next.id) {
          queue.shift();
          saveJson('queue', queue);
        }
        location.href = next.url;
      }
    }, 1000);
  }

  function cancelAutoplayCountdown() {
    clearInterval(autoplayTimer);
    const overlay = $('#autoplayOverlay');
    if (overlay) overlay.hidden = true;
  }

  $('#cancelAutoplayBtn')?.addEventListener('click', cancelAutoplayCountdown);
  $('#playNextNowBtn')?.addEventListener('click', () => {
    cancelAutoplayCountdown();
    const next = getNextVideoUrl();
    if (next) location.href = next.url;
  });

  // Mini Player (Picture-in-Picture)
  const playerContainer = $('#playerContainer');
  const miniPlayer = $('#miniPlayer');
  const miniSlot = $('#miniPlayerVideoSlot');
  const playerIframe = $('#player');

  function toggleMiniPlayer(force) {
    const shouldMini = typeof force === 'boolean' ? force : !isMiniPlayer;
    if (shouldMini === isMiniPlayer) return;
    isMiniPlayer = shouldMini;

    if (isMiniPlayer) {
      if (playerIframe && miniSlot) {
        miniSlot.appendChild(playerIframe);
        miniPlayer.hidden = false;
        document.body.classList.add('mini-player-active');
      }
    } else {
      if (playerIframe && playerContainer) {
        $('.player-shell', playerContainer)?.appendChild(playerIframe);
        miniPlayer.hidden = true;
        document.body.classList.remove('mini-player-active');
      }
    }
  }

  $('#pipButton')?.addEventListener('click', () => toggleMiniPlayer());
  $('#miniPlayerExpand')?.addEventListener('click', () => toggleMiniPlayer(false));
  $('#miniPlayerClose')?.addEventListener('click', () => toggleMiniPlayer(false));

  // Description Expand / Collapse
  const descBox = $('#descriptionBox');
  const descToggle = $('#descriptionToggle');
  descToggle?.addEventListener('click', () => {
    const expanded = descBox.classList.toggle('expanded');
    descToggle.textContent = expanded ? '一部を表示' : 'もっと見る';
  });

  // Subscribe Button
  const subBtn = $('#subscribeButton');
  const channelId = subBtn?.dataset.channelId;
  const isAuth = document.body.dataset.authenticated === 'true';

  function updateSubButton(subscribed) {
    if (!subBtn) return;
    subBtn.classList.toggle('subscribed', subscribed);
    subBtn.textContent = subscribed ? '登録済み' : 'チャンネル登録';
  }

  if (subBtn && channelId) {
    if (isAuth) {
      fetch('/api/account/channel-state?id=' + encodeURIComponent(channelId))
        .then(r => r.json())
        .then(d => { if (d.authenticated) updateSubButton(d.subscribed); })
        .catch(() => {});
    } else {
      const localSubs = safeJson('subscriptions', []);
      updateSubButton(localSubs.some(c => c.id === channelId));
    }

    subBtn.addEventListener('click', async () => {
      subBtn.disabled = true;
      try {
        if (isAuth) {
          const state = await fetch('/api/account/channel-state?id=' + encodeURIComponent(channelId)).then(r => r.json());
          const action = state.subscribed ? 'unsubscribe' : 'subscribe';
          const res = await fetch('/api/interact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, channelId })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '操作に失敗しました');
          updateSubButton(action === 'subscribe');
          notify(action === 'subscribe' ? 'チャンネル登録しました' : 'チャンネル登録を解除しました');
        } else {
          let list = safeJson('subscriptions', []);
          const joined = list.some(x => x.id === channelId);
          list = joined ? list.filter(x => x.id !== channelId) : [{ id: channelId, name: subBtn.dataset.channelName, avatar: subBtn.dataset.channelAvatar }, ...list];
          saveJson('subscriptions', list);
          updateSubButton(!joined);
          notify(!joined ? 'チャンネル登録しました' : 'チャンネル登録を解除しました');
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
    if (isAuth) {
      fetch('/api/account/video-state?id=' + encodeURIComponent(videoId))
        .then(r => r.json())
        .then(d => { if (d.authenticated) updateLikeUI(d.liked); })
        .catch(() => {});
    } else {
      const likedVideos = safeJson('likedVideos', []);
      updateLikeUI(likedVideos.includes(videoId));
    }

    likeBtn.addEventListener('click', async () => {
      const active = likeBtn.classList.contains('active');
      if (isAuth) {
        try {
          const res = await fetch('/api/interact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: active ? 'removeRating' : 'like', videoId })
          });
          if (res.ok) {
            updateLikeUI(!active);
            notify(!active ? '高評価しました' : '高評価を取り消しました');
          }
        } catch {
          notify('操作に失敗しました');
        }
      } else {
        let list = safeJson('likedVideos', []);
        list = active ? list.filter(x => x !== videoId) : [videoId, ...list];
        saveJson('likedVideos', list);
        updateLikeUI(!active);
        notify(!active ? '高評価しました' : '高評価を取り消しました');
      }
    });

    dislikeBtn?.addEventListener('click', () => {
      const active = dislikeBtn.classList.contains('active');
      updateDislikeUI(!active);
      notify(!active ? '低評価を付けました' : '低評価を取り消しました');
    });
  }

  // Save (Watch Later) Button
  const saveBtn = $('#saveButton');
  if (saveBtn) {
    const isSaved = () => safeJson('watchLater', []).includes(videoId);
    const paintSave = () => {
      const saved = isSaved();
      saveBtn.classList.toggle('active', saved);
      saveBtn.querySelector('span').textContent = saved ? '保存済み' : '保存';
    };
    paintSave();
    saveBtn.addEventListener('click', () => {
      let list = safeJson('watchLater', []);
      const saved = list.includes(videoId);
      list = saved ? list.filter(x => x !== videoId) : [videoId, ...list];
      saveJson('watchLater', list);
      paintSave();
      notify(saved ? '後で見るから削除しました' : '後で見るに保存しました');
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
  });

  // Edu / YouTube Player Mode Switcher
  const playerModeBtn = $('#playerButton');
  if (playerModeBtn) {
    let eduSources = [];
    try { eduSources = JSON.parse(playerModeBtn.dataset.eduSources || '[]'); } catch {}

    const applyPlayerMode = () => {
      const mode = playerModeBtn.dataset.mode;
      const iframe = $('#player');
      if (!iframe) return;
      if (mode === 'youtube') {
        iframe.src = playerModeBtn.dataset.youtube;
        playerModeBtn.querySelector('span').textContent = '通常';
        return;
      }
      const index = Math.max(0, Math.min(eduSources.length - 1, Number(localStorage.getItem('playerEduSource') || 0)));
      const source = eduSources[index] || { url: playerModeBtn.dataset.edu, name: 'Edu' };
      playerModeBtn.dataset.eduIndex = String(index);
      iframe.src = source.url;
      playerModeBtn.querySelector('span').textContent = eduSources.length ? `Edu ${index + 1}` : 'Edu';
      playerModeBtn.title = eduSources.length ? source.name : 'Edu';
    };

    playerModeBtn.addEventListener('click', () => {
      if (playerModeBtn.dataset.mode === 'youtube') {
        playerModeBtn.dataset.mode = 'edu';
        localStorage.setItem('playerMode', 'edu');
        applyPlayerMode();
        return;
      }
      const next = Number(playerModeBtn.dataset.eduIndex || 0) + 1;
      if (next < eduSources.length) {
        localStorage.setItem('playerEduSource', String(next));
        localStorage.setItem('playerMode', 'edu');
        applyPlayerMode();
      } else {
        playerModeBtn.dataset.mode = 'youtube';
        localStorage.setItem('playerMode', 'youtube');
        applyPlayerMode();
      }
    });

    const pref = localStorage.getItem('playerMode');
    if (pref === 'youtube') {
      playerModeBtn.dataset.mode = 'youtube';
      applyPlayerMode();
    }
  }

  // --- Comments Section ---
  const commentsList = $('#commentsList');
  const commentComposer = $('#commentComposer');
  const commentText = $('#commentText');
  const commentActions = $('#commentComposerActions');
  const submitCommentBtn = $('#submitCommentBtn');
  const cancelCommentBtn = $('#cancelCommentBtn');
  let currentSort = 'top';

  async function loadComments(sort = 'top') {
    if (!commentsList) return;
    commentsList.innerHTML = '<div class="comments-loading">コメントを読み込み中…</div>';
    try {
      const res = await fetch(`/api/comments?v=${encodeURIComponent(videoId)}&sort=${sort}`).then(r => r.json());
      const comments = res.comments || [];
      const countHeader = $('#commentsCountHeader');
      if (countHeader) countHeader.textContent = comments.length ? `コメント ${comments.length} 件` : 'コメント';

      if (!comments.length) {
        commentsList.innerHTML = '<div class="comments-empty">コメントはありません</div>';
        return;
      }

      commentsList.innerHTML = comments.map(c => `
        <article class="comment-item">
          ${c.avatar ? `<img class="comment-avatar" src="${esc(c.avatar)}" alt="">` : `<span class="comment-avatar fallback">${esc(c.author.slice(0, 1))}</span>`}
          <div class="comment-content">
            <div class="comment-meta">
              <b class="comment-author">${esc(c.author)}</b>
              <small class="comment-time">${esc(c.published)}</small>
            </div>
            <p class="comment-body">${esc(c.body)}</p>
            <div class="comment-actions">
              <button class="comment-like-btn" type="button" aria-label="高評価">
                <svg class="icon"><use href="#i-like"></use></svg>
                <span>${esc(c.likes || '')}</span>
              </button>
              <button class="comment-dislike-btn" type="button" aria-label="低評価">
                <svg class="icon"><use href="#i-dislike"></use></svg>
              </button>
              ${c.replies ? `<button class="comment-reply-btn" type="button">返信 ${c.replies}</button>` : '<button class="comment-reply-btn" type="button">返信</button>'}
            </div>
          </div>
        </article>
      `).join('');
    } catch {
      commentsList.innerHTML = '<div class="comments-empty">コメントを読み込めませんでした</div>';
    }
  }

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
      if (!res.ok) throw new Error(data.error || 'コメントに失敗しました');
      commentText.value = '';
      if (commentActions) commentActions.hidden = true;
      notify('コメントを投稿しました');
      loadComments(currentSort);
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

  // Load comments immediately on watch page
  loadComments('top');

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
      streamList.innerHTML = (res.formats || []).map(f => `
        <div class="stream-format">
          <b>${esc(f.quality || '音声')}</b>
          <span>${esc(f.mimeType)}</span>
          <small>${f.fps ? `${f.fps}fps・` : ''}${f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps` : ''}</small>
        </div>
      `).join('') || '<p class="muted">利用可能な形式がありません</p>';
    } catch (e) {
      streamList.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  });
  streamDialog?.querySelector('.modal-close')?.addEventListener('click', () => {
    streamDialog.hidden = true;
  });

  // --- Keyboard Shortcuts Controller ---
  document.addEventListener('keydown', e => {
    // Ignore when typing in input/textarea
    if (e.target.matches('input, textarea, [contenteditable="true"]')) return;

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
        } else if (e.shiftKey && key === 'n') {
          e.preventDefault();
          const next = getNextVideoUrl();
          if (next) location.href = next.url;
        }
      } catch (err) {
        console.warn('Player shortcut error:', err);
      }
    }
  });

  initIframePlayer();
})();

// --- Home Recommendations, Category Chips, and Shorts Shelf ---
(() => {
  if (document.body.dataset.page !== 'home') return;

  const grid = $('#recommendationGrid');
  const chipsNav = $('#homeChips');
  const btnLeft = $('#chipsLeft');
  const btnRight = $('#chipsRight');

  // Category Chips Horizontal Scroll
  if (chipsNav) {
    const updateChipsNav = () => {
      if (btnLeft) btnLeft.hidden = chipsNav.scrollLeft <= 4;
      if (btnRight) btnRight.hidden = chipsNav.scrollLeft >= chipsNav.scrollWidth - chipsNav.clientWidth - 4;
    };
    chipsNav.addEventListener('scroll', updateChipsNav, { passive: true });
    updateChipsNav();

    btnLeft?.addEventListener('click', () => chipsNav.scrollBy({ left: -220, behavior: 'smooth' }));
    btnRight?.addEventListener('click', () => chipsNav.scrollBy({ left: 220, behavior: 'smooth' }));
  }

  if (!grid) return;

  function renderCard(v) {
    const href = `/watch?v=${encodeURIComponent(v.id)}`;
    const avatar = v.authorThumbnail
      ? `<img class="channel-avatar" src="${esc(v.authorThumbnail)}" alt="">`
      : `<span class="channel-avatar fallback">${esc((v.author || 'Y').slice(0, 1))}</span>`;
    const dur = v.duration ? `<span class="duration">${esc(v.duration)}</span>` : '';
    const reasons = v.reasons?.length ? `<span class="recommend-reason">${esc(v.reasons.join('・'))}からおすすめ</span>` : '';

    return `
      <article class="video-card" data-video-id="${esc(v.id)}">
        <a class="thumb" href="${href}">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy">
          ${dur}
        </a>
        <div class="card-info">
          ${avatar}
          <div class="card-copy">
            <a class="video-title" href="${href}">${esc(v.title)}</a>
            ${v.authorId ? `<a class="channel-name-link" href="/channel/${encodeURIComponent(v.authorId)}">${esc(v.author || 'YouTube')}</a>` : `<span>${esc(v.author || 'YouTube')}</span>`}
            <span>${esc([v.views, v.published].filter(Boolean).join('・'))}</span>
            ${reasons}
          </div>
          <button class="more-btn" aria-label="その他のアクション" data-video-id="${esc(v.id)}" data-title="${esc(v.title)}">
            <svg class="icon"><use href="#i-more"></use></svg>
          </button>
        </div>
      </article>
    `;
  }

  function renderShort(v) {
    const href = `/shorts/${encodeURIComponent(v.id)}`;
    const avatar = v.authorThumbnail
      ? `<img src="${esc(v.authorThumbnail)}" alt="">`
      : `<span class="fallback">${esc((v.author || 'Y').slice(0, 1))}</span>`;

    return `
      <article class="home-short-card">
        <a class="home-short-thumb" href="${href}">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy">
          <span class="home-short-play"><svg class="icon"><use href="#i-shorts"></use></svg></span>
        </a>
        <div class="home-short-copy">
          <a href="${href}">${esc(v.title)}</a>
          <div class="home-short-channel">
            ${avatar}
            <span>${esc(v.author || 'YouTube')}</span>
          </div>
          <small>${esc(v.views || '')}</small>
        </div>
      </article>
    `;
  }

  function paintShortsShelf(shorts = []) {
    let shelf = $('.home-shorts-shelf');
    if (!shorts.length) {
      if (shelf) shelf.remove();
      return;
    }
    if (!shelf) {
      shelf = document.createElement('section');
      shelf.className = 'home-shorts-shelf';
      grid.insertAdjacentElement('afterend', shelf);
    }
    shelf.innerHTML = `
      <div class="home-shelf-heading">
        <div><h2><svg class="icon"><use href="#i-shorts"></use></svg> Shorts</h2></div>
        <a href="/shorts">すべて見る</a>
      </div>
      <div class="home-shorts-row">${shorts.map(renderShort).join('')}</div>
    `;
  }

  async function loadHomeVideos(force = false) {
    const isAuth = document.body.dataset.authenticated === 'true';
    const cached = safeJson('recommendationCache', null);

    if (!force && cached?.videos?.length && Date.now() - (cached.savedAt || 0) < 300000) {
      grid.innerHTML = cached.videos.map(renderCard).join('');
      paintShortsShelf(cached.shorts || []);
      return;
    }

    // Render Skeletons
    grid.innerHTML = Array.from({ length: 8 }, () => `
      <article class="video-card recommend-skeleton-card" aria-hidden="true">
        <div class="thumb skeleton-box"></div>
        <div class="card-info">
          <span class="channel-avatar skeleton-circle"></span>
          <div class="card-copy">
            <span class="skeleton-line skeleton-title"></span>
            <span class="skeleton-line"></span>
            <span class="skeleton-line skeleton-short"></span>
          </div>
        </div>
      </article>
    `).join('');

    const payload = isAuth ? {} : {
      searches: safeJson('searchHistory', []),
      subscriptions: safeJson('subscriptions', []),
      exclude: force ? [] : safeJson('history', []).slice(0, 3)
    };

    try {
      const res = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      if (res.videos?.length || res.shorts?.length) {
        grid.innerHTML = (res.videos || []).map(renderCard).join('');
        paintShortsShelf(res.shorts || []);
        saveJson('recommendationCache', {
          savedAt: Date.now(),
          videos: res.videos || [],
          shorts: res.shorts || []
        });
      } else {
        grid.innerHTML = `<div class="empty"><h2>${esc(res.error || 'おすすめ動画がありません')}</h2></div>`;
      }
    } catch {
      grid.innerHTML = '<div class="empty"><h2>おすすめを取得できませんでした</h2></div>';
    }
  }

  loadHomeVideos();
})();

// --- Shorts Reel Controller ---
(() => {
  if (document.body.dataset.page !== 'shorts') return;

  const feed = $('#shortsFeed');
  let reels = $$('.short-reel');
  const panel = $('#shortComments');
  const list = $('#shortCommentsList');
  if (!feed || !reels.length) return;

  let activeIndex = 0;
  let loading = false;
  let hasMore = Boolean(feed.dataset.shortToken);
  const token = feed.dataset.shortToken || '';
  let currentCommentId = '';

  function activateShort(reel, idx) {
    if (!reel) return;
    activeIndex = idx;
    reels.forEach((item, itemIdx) => {
      const frame = item.querySelector('.short-player');
      if (itemIdx === idx) {
        if (frame.dataset.src && !frame.src) frame.src = frame.dataset.src;
      } else {
        frame.removeAttribute('src');
      }
    });

    const shortId = reel.dataset.shortId;
    history.replaceState(null, '', `/shorts/${shortId}`);
    if (activeIndex >= reels.length - 3) loadMoreShorts();
  }

  async function loadMoreShorts() {
    if (loading || !hasMore || !token) return;
    loading = true;
    try {
      const res = await fetch('/api/shorts/next?token=' + encodeURIComponent(token)).then(r => r.json());
      const batch = res.videos || [];
      if (batch.length) {
        batch.forEach(short => {
          if (reels.some(r => r.dataset.shortId === short.id)) return;
          const article = document.createElement('article');
          article.className = 'short-reel';
          article.dataset.shortId = short.id;
          article.dataset.shortIndex = String(reels.length);
          article.innerHTML = `
            <div class="short-shell">
              <iframe class="short-player" src="" data-src="${esc(short.eduUrl || '')}" title="${esc(short.title || '')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
              <div class="short-scroll-capture" aria-hidden="true"></div>
              <div class="short-overlay">
                <a href="${short.authorId ? '/channel/' + encodeURIComponent(short.authorId) : '#'}" class="short-author">
                  ${short.authorThumbnail ? `<img src="${esc(short.authorThumbnail)}" alt="">` : `<span class="fallback">${esc(short.author.slice(0, 1))}</span>`}
                  <b>${esc(short.author)}</b>
                </a>
                <p>${esc(short.title)}</p>
              </div>
            </div>
            <div class="short-actions">
              <button class="short-like"><svg class="icon"><use href="#i-like"></use></svg><span>高評価</span></button>
              <button class="short-comment"><svg class="icon"><use href="#i-news"></use></svg><span>コメント</span></button>
              <button class="short-share"><svg class="icon"><use href="#i-share"></use></svg><span>共有</span></button>
              <button class="short-save"><svg class="icon"><use href="#i-clock"></use></svg><span>保存</span></button>
              <button class="short-mute" type="button"><svg class="icon"><use href="#i-music"></use></svg><span>音声</span></button>
              <button class="short-clear" type="button"><svg class="icon"><use href="#i-screen"></use></svg><span>クリア</span></button>
              <a href="/watch?v=${encodeURIComponent(short.id)}"><svg class="icon"><use href="#i-screen"></use></svg><span>通常再生</span></a>
            </div>
          `;
          feed.appendChild(article);
        });
        reels = $$('.short-reel');
        reels.slice(-batch.length).forEach(observeReel);
      }
      hasMore = Boolean(res.hasMore);
    } catch {}
    finally { loading = false; }
  }

  function observeReel(reel) {
    observer.observe(reel);
    const capture = reel.querySelector('.short-scroll-capture');
    capture?.addEventListener('wheel', e => {
      e.preventDefault();
      feed.scrollBy({ top: e.deltaY, behavior: 'smooth' });
    }, { passive: false });
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio > 0.7) {
        const found = reels.indexOf(entry.target);
        if (found >= 0) activateShort(entry.target, found);
      }
    });
  }, { root: feed, threshold: [0.7] });

  reels.forEach(observeReel);

  const move = delta => {
    const next = Math.max(0, Math.min(reels.length - 1, activeIndex + delta));
    if (next !== activeIndex) {
      reels[next].scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  $('#previousShort')?.addEventListener('click', () => move(-1));
  $('#nextShort')?.addEventListener('click', () => move(1));

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (['ArrowDown', 'j'].includes(e.key)) { e.preventDefault(); move(1); }
    if (['ArrowUp', 'k'].includes(e.key)) { e.preventDefault(); move(-1); }
  });

  // Short Actions: Like, Comment, Save, Share
  feed.addEventListener('click', async e => {
    const reel = e.target.closest('.short-reel');
    if (!reel) return;
    const id = reel.dataset.shortId;

    if (e.target.closest('.short-like')) {
      const btn = reel.querySelector('.short-like');
      const active = btn?.classList.contains('active');
      btn?.classList.toggle('active', !active);
      notify(!active ? '高評価しました' : '高評価を取り消しました');
      fetch('/api/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: active ? 'removeRating' : 'like', videoId: id })
      }).catch(() => {});
    }

    if (e.target.closest('.short-save')) {
      let list = safeJson('watchLater', []);
      const exists = list.includes(id);
      list = exists ? list.filter(x => x !== id) : [id, ...list];
      saveJson('watchLater', list);
      reel.querySelector('.short-save')?.classList.toggle('active', !exists);
      notify(!exists ? '後で見るに保存しました' : '後で見るから削除しました');
    }

    if (e.target.closest('.short-share')) {
      const url = `${location.origin}/shorts/${id}`;
      try {
        await navigator.share({ title: document.title, url });
      } catch {
        await navigator.clipboard.writeText(url);
        notify('リンクをコピーしました');
      }
    }

    if (e.target.closest('.short-clear')) {
      document.body.classList.toggle('short-clear-screen');
    }

    if (e.target.closest('.short-comment')) {
      currentCommentId = id;
      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
      loadShortComments(id);
    }
  });

  $('#closeShortComments')?.addEventListener('click', () => {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  });

  async function loadShortComments(id) {
    if (!list) return;
    list.innerHTML = '<p class="muted">読み込み中…</p>';
    try {
      const res = await fetch(`/api/comments?v=${encodeURIComponent(id)}&sort=top`).then(r => r.json());
      list.innerHTML = (res.comments || []).map(c => `
        <article class="short-comment">
          ${c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : `<span class="comment-avatar fallback">${esc(c.author.slice(0, 1))}</span>`}
          <div>
            <b>${esc(c.author)}</b> <small>${esc(c.published)}</small>
            <p>${esc(c.body)}</p>
          </div>
        </article>
      `).join('') || '<p class="muted">コメントはありません</p>';
    } catch {
      list.innerHTML = '<p class="muted">コメントを読み込めませんでした</p>';
    }
  }

  // Activate initial short (matching URL hash or /shorts/:id)
  const pathnameMatch = location.pathname.match(/\/shorts\/([\w-]{11})/);
  const hashId = location.hash.slice(1) || pathnameMatch?.[1];
  const startIdx = hashId ? reels.findIndex(r => r.dataset.shortId === hashId) : 0;
  if (startIdx >= 0 && reels[startIdx]) {
    reels[startIdx].scrollIntoView({ block: 'start' });
    activateShort(reels[startIdx], startIdx);
  } else if (reels[0]) {
    activateShort(reels[0], 0);
  }
})();

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
  const isAuth = document.body.dataset.authenticated === 'true';

  const keys = { history: 'history', watchLater: 'watchLater', subscriptions: 'subscriptions', likedVideos: 'likedVideos' };
  const storageKey = keys[type];

  function renderVideoCard(v) {
    return `
      <article class="video-card" data-video-id="${esc(v.id)}">
        <a class="thumb" href="/watch?v=${encodeURIComponent(v.id)}">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy">
          ${v.duration ? `<span class="duration">${esc(v.duration)}</span>` : ''}
        </a>
        <div class="card-info">
          ${v.authorThumbnail ? `<img class="channel-avatar" src="${esc(v.authorThumbnail)}" alt="">` : `<span class="channel-avatar fallback">${esc((v.author || 'Y').slice(0, 1))}</span>`}
          <div class="card-copy">
            <a class="video-title" href="/watch?v=${encodeURIComponent(v.id)}">${esc(v.title)}</a>
            <span>${esc(v.author)}</span>
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
    grid.innerHTML = '';

    if (isAuth && type === 'likedVideos') {
      try {
        const res = await fetch('/api/account/liked').then(r => r.json());
        const videos = res.videos || [];
        status.hidden = true;
        grid.innerHTML = videos.length ? videos.map(renderVideoCard).join('') : '<div class="library-empty">高評価した動画はありません</div>';
        if (countEl) countEl.textContent = `${videos.length}件`;
        return;
      } catch {}
    }

    if (isAuth && type === 'subscriptions') {
      try {
        grid.classList.add('channel-library');
        const res = await fetch('/api/account/subscriptions').then(r => r.json());
        const channels = res.channels || [];
        status.hidden = true;
        grid.innerHTML = channels.length ? channels.map(renderChannelCard).join('') : '<div class="library-empty">登録チャンネルはありません</div>';
        if (countEl) countEl.textContent = `${channels.length}件`;
        return;
      } catch {}
    }

    const ids = safeJson(storageKey, []);
    if (!ids.length) {
      status.hidden = true;
      grid.innerHTML = `<div class="library-empty">${type === 'history' ? '視聴履歴はありません' : '保存されたアイテムはありません'}</div>`;
      if (clearBtn) clearBtn.hidden = true;
      if (countEl) countEl.textContent = '0件';
      return;
    }

    if (type === 'subscriptions') {
      grid.classList.add('channel-library');
      status.hidden = true;
      grid.innerHTML = ids.map(renderChannelCard).join('');
      if (countEl) countEl.textContent = `${ids.length}件`;
      return;
    }

    try {
      const res = await fetch('/api/videos?ids=' + encodeURIComponent(ids.join(','))).then(r => r.json());
      const videos = res.videos || [];
      status.hidden = true;
      grid.innerHTML = videos.length ? videos.map(renderVideoCard).join('') : '<div class="library-empty">動画を取得できませんでした</div>';
      if (countEl) countEl.textContent = `${videos.length}件`;
    } catch {
      status.hidden = true;
      grid.innerHTML = '<div class="library-empty">動画の読み込みに失敗しました</div>';
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
  playAllBtn?.addEventListener('click', () => {
    const cards = $$('.video-card', grid);
    if (!cards.length) return;
    const ids = cards.map(c => c.dataset.videoId).filter(Boolean);
    if (!ids.length) return;
    saveJson('queue', ids.slice(1));
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

  loadLibraryData();
})();

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
    if (document.body.dataset.authenticated === 'true') {
      try {
        const res = await fetch('/api/account/subscriptions').then(r => r.json());
        renderSidebarChannels(res.channels || []);
        return;
      } catch {}
    }
    const local = safeJson('subscriptions', []);
    renderSidebarChannels(local);
  }

  loadSidebarSubs();
})();

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

  function showSection(status) {
    Object.values(sections).forEach(s => { if (s) s.hidden = true; });
    (sections[status] || sections.signed_out).hidden = false;
  }

  dialog.querySelector('.modal-close')?.addEventListener('click', () => {
    dialog.hidden = true;
    clearTimeout(pollTimer);
  });

  async function refreshAuthStatus(keepPolling = false) {
    try {
      const res = await fetch('/api/auth/status').then(r => r.json());
      showSection(res.status);
      document.body.dataset.authenticated = res.status === 'signed_in' ? 'true' : 'false';

      const avatar = $('#accountAvatar');
      if (avatar) avatar.textContent = res.status === 'signed_in' ? '✓' : 'W';

      const menuName = $('#menuAccountName');
      const menuHandle = $('#menuAccountHandle');
      if (menuName && res.account?.name) menuName.textContent = res.account.name;
      if (menuHandle && res.account?.handle) menuHandle.textContent = res.account.handle;

      if (res.status === 'pending' || res.status === 'starting') {
        if (res.userCode) {
          const codeBtn = $('#copyAuthCode');
          if (codeBtn) codeBtn.textContent = res.userCode;
        }
        pollTimer = setTimeout(() => refreshAuthStatus(true), 2000);
      }
    } catch {}
  }

  async function startAuth() {
    showSection('starting');
    try {
      await fetch('/api/auth/start', { method: 'POST' });
      refreshAuthStatus(true);
    } catch {}
  }

  $('#startAuthButton')?.addEventListener('click', startAuth);
  $('#retryAuthButton')?.addEventListener('click', startAuth);

  $('#copyAuthCode')?.addEventListener('click', async () => {
    const code = $('#copyAuthCode')?.textContent.trim();
    if (code) {
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

  refreshAuthStatus(false);
})();

// --- Top Loading Progress Bar ---
(() => {
  const bar = $('#pageProgress')?.firstElementChild;
  if (!bar) return;
  let val = 0, frame = 0, finishing = false;

  function step() {
    val += (finishing ? 100 - val : 85 - val) * 0.15;
    bar.style.transform = `scaleX(${val / 100})`;
    if (finishing && val > 99) {
      bar.style.opacity = '0';
      cancelAnimationFrame(frame);
      return;
    }
    frame = requestAnimationFrame(step);
  }

  function start() {
    cancelAnimationFrame(frame);
    val = 10;
    finishing = false;
    bar.style.opacity = '1';
    frame = requestAnimationFrame(step);
  }

  function finish() {
    finishing = true;
  }

  start();
  if (document.readyState === 'complete') finish();
  else window.addEventListener('load', finish, { once: true });

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin && url.href !== location.href) {
      start();
    }
  });
})();
