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
        const response = await fetch('/api/notifications');
        const res = await response.json();
        if (!response.ok || res.status === 'error') throw new Error(res.error || '通知を取得できませんでした。');
        const items = res.notifications || [];
        if (res.status === 'signed_out') {
          notifList.innerHTML = '<div class="popover-empty">通知を表示するにはログインしてください。</div><button class="popover-item" id="notificationsLogin" type="button">ログイン</button>';
          $('#notificationsLogin')?.addEventListener('click', () => {
            notifPopover.hidden = true;
            if (authDialog) {
              authDialog.hidden = false;
              authDialog.dispatchEvent(new Event('wetube:auth-open'));
            }
          });
        } else if (!items.length) {
          notifList.innerHTML = '<div class="popover-empty">新しい通知はありません</div>';
          notifsLoaded = true;
        } else {
          notifList.innerHTML = items.map(n => `
            <a class="notif-item" href="${esc(n.url)}">
              <div class="notif-avatar-wrap">
                ${n.authorThumbnail ? `<img class="notif-avatar" src="${esc(n.authorThumbnail)}" alt="">` : ''}
              </div>
              <div class="notif-copy">
                <p>${esc(n.title)}</p>
                <small>${esc(n.published)}</small>
              </div>
              ${n.thumbnail ? `<img class="notif-thumb" src="${esc(n.thumbnail)}" alt="">` : ''}
            </a>
          `).join('');
          notifsLoaded = true;
        }
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
      authDialog.dispatchEvent(new Event('wetube:auth-open'));
    }
  });

  // --- Rich Search Bar & Dropdown Suggestions ---
  const searchInput = $('#searchInput');
  const searchClear = $('#searchClear');
  const searchSuggestions = $('#searchSuggestions');
  const mobileSearchOpen = $('#mobileSearchOpen');
  const mobileSearchClose = $('#mobileSearchClose');
  let suggestTimer = null;
  let suggestController = null;
  let activeIndex = -1;

  function closeMobileSearch({ restoreFocus = false } = {}) {
    body.classList.remove('mobile-search-open');
    searchSuggestions && (searchSuggestions.hidden = true);
    if (restoreFocus) mobileSearchOpen?.focus();
  }
  mobileSearchOpen?.addEventListener('click', () => {
    body.classList.add('mobile-search-open');
    requestAnimationFrame(() => searchInput?.focus());
  });
  mobileSearchClose?.addEventListener('click', () => closeMobileSearch({ restoreFocus: true }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && body.classList.contains('mobile-search-open')) {
      event.preventDefault();
      closeMobileSearch({ restoreFocus: true });
    }
  });

  async function getSearchHistory() {
    try {
      const auth = await getAccountAuthStatus();
      return auth.status === 'signed_out' ? safeJson('searchHistory', []) : [];
    } catch (error) {
      console.error('Search history authentication status:', error);
      return [];
    }
  }

  async function renderSuggestions(query = '', suggestions = []) {
    const history = (await getSearchHistory()).filter(h => !query || h.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
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
    suggestController?.abort();
    if (!val.trim()) {
      void renderSuggestions('');
      return;
    }
    suggestTimer = setTimeout(async () => {
      suggestController = new AbortController();
      const query = val.trim();
      try {
        const response = await fetch('/api/suggestions?q=' + encodeURIComponent(query), { signal: suggestController.signal });
        const res = await response.json();
        if (!response.ok) throw new Error(res.error || '候補を取得できませんでした。');
        if (searchInput.value.trim() === query) void renderSuggestions(query, res.suggestions || []);
      } catch (error) {
        if (error.name !== 'AbortError' && searchInput.value.trim() === query) void renderSuggestions(query, []);
      }
    }, 150);
  });

  searchInput?.addEventListener('focus', () => {
    const val = searchInput.value;
    searchClear.hidden = !val;
    if (!val.trim()) {
      void renderSuggestions('');
    } else {
      searchInput.dispatchEvent(new Event('input'));
    }
  });

  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    searchInput.focus();
    void renderSuggestions('');
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
      void (async () => {
        try {
          const auth = await getAccountAuthStatus();
          if (auth.status !== 'signed_out') return;
          const target = delBtn.dataset.del;
          const history = (await getSearchHistory()).filter(h => h !== target);
          saveJson('searchHistory', history);
          delBtn.closest('.suggestion-item')?.remove();
          if (!searchSuggestions.children.length) searchSuggestions.hidden = true;
        } catch (error) {
          console.error('Delete search history:', error);
        }
      })();
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
  document.querySelector('.search-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const q = searchInput?.value.trim();
    closeMobileSearch();
    void (async () => {
      try {
        const auth = await getAccountAuthStatus();
        if (q && auth.status === 'signed_out') {
          const history = [q, ...(await getSearchHistory()).filter(x => x !== q)].slice(0, 20);
          saveJson('searchHistory', history);
        }
      } catch (error) {
        console.error('Search history authentication status:', error);
      }
      form.submit();
    })();
  });
})();
