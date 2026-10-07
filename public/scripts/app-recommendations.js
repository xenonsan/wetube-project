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
  let loadingMore = false;
  let hasMore = true;
  let loadedShorts = [];
  let loadMoreObserver;
  let loadMoreIntersecting = false;
  let loadMoreScrollFallback = false;

  function renderCard(v) {
    const href = `/watch?v=${encodeURIComponent(v.id)}`;
    const avatar = v.authorThumbnail
      ? `<img class="channel-avatar" src="${esc(v.authorThumbnail)}" alt="">`
      : `<span class="channel-avatar fallback">${esc((v.author || 'Y').slice(0, 1))}</span>`;
    const dur = v.duration ? `<span class="duration">${esc(v.duration)}</span>` : '';
    return `
      <article class="video-card" data-video-id="${esc(v.id)}">
        <a class="thumb" href="${href}">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy" data-video-fallback="${esc(v.id)}">
          ${dur}
        </a>
        <div class="card-info">
          ${v.authorId ? `<a class="channel-avatar-link" href="/channel/${encodeURIComponent(v.authorId)}">${avatar}</a>` : avatar}
          <div class="card-copy">
            <a class="video-title" href="${href}">${esc(v.title)}</a>
            ${v.authorId ? `<a class="channel-name-link" href="/channel/${encodeURIComponent(v.authorId)}">${esc(v.author || 'YouTube')}</a>` : `<span>${esc(v.author || 'YouTube')}</span>`}
            <span>${esc([v.views, v.published].filter(Boolean).join('・'))}</span>
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
      <article class="home-short-card" data-video-id="${esc(v.id)}">
        <a class="home-short-thumb" href="${href}">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy" data-video-fallback="${esc(v.id)}">
          <span class="home-short-play"><svg class="icon"><use href="#i-shorts"></use></svg></span>
        </a>
        <div class="home-short-copy">
            <a class="home-short-title" href="${href}">${esc(v.title || v.name || 'ショート動画')}</a>
          <div class="home-short-channel">
            ${v.authorId ? `<a class="home-short-avatar-link" href="/channel/${encodeURIComponent(v.authorId)}">${avatar}</a>` : avatar}
            ${v.authorId ? `<a href="/channel/${encodeURIComponent(v.authorId)}">${esc(v.author || 'YouTube')}</a>` : `<span>${esc(v.author || 'YouTube')}</span>`}
          </div>
          <small>${esc(v.views || '')}</small>
        </div>
      </article>
    `;
  }

  function paintShortsShelf(shorts = []) {
    loadedShorts = [...new Map(shorts.filter(video => video?.id).map(video => [video.id, video])).values()];
    let shelf = $('.home-shorts-shelf');
    if (!loadedShorts.length) {
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
      <div class="home-shorts-row">${loadedShorts.map(renderShort).join('')}</div>
    `;
    ensureHomeLoadSentinel();
  }

  function ensureHomeLoadSentinel() {
    let control = $('#homeLoadMore');
    if (!control) {
      control = document.createElement('div');
      control.id = 'homeLoadMore';
      control.className = 'home-load-more';
      control.innerHTML = '<span class="home-load-status" role="status" aria-live="polite"></span>';
    }
    const anchor = $('.home-shorts-shelf') || grid;
    if (anchor.nextElementSibling !== control) anchor.insertAdjacentElement('afterend', control);
    if ('IntersectionObserver' in window) {
      loadMoreObserver ||= new IntersectionObserver(entries => {
        const isIntersecting = entries.some(entry => entry.isIntersecting);
        if (isIntersecting && !loadMoreIntersecting && hasMore) loadMoreVideos();
        loadMoreIntersecting = isIntersecting;
      }, { rootMargin: '700px 0px' });
      loadMoreObserver.observe(control);
    }
    if (!loadMoreScrollFallback) {
      let scheduled = false;
      const checkPosition = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          if (!control.hidden && control.getBoundingClientRect().top < window.innerHeight + 700 && hasMore) loadMoreVideos();
        });
      };
      window.addEventListener('scroll', checkPosition, { passive:true });
      window.addEventListener('resize', checkPosition, { passive:true });
      loadMoreScrollFallback = true;
      checkPosition();
    }
    control.hidden = !hasMore;
    return control;
  }

  function recommendationPayload(exclude = []) {
    if (document.body.dataset.authenticated === 'true') return { exclude };
    const history = safeJson('history', []);
    const watchedIds = (Array.isArray(history) ? history : [])
      .map(item => typeof item === 'string' ? item : item?.id)
      .filter(id => /^[\w-]{11}$/.test(String(id || '')));
    return {
      searches: safeJson('searchHistory', []),
      subscriptions: safeJson('subscriptions', []),
      watched: watchedIds.slice(0, 8).map(id => ({ id, seconds: 0 })),
      exclude: [...new Set([...watchedIds.slice(0, 3), ...exclude])]
    };
  }

  async function syncRecommendationAuth() {
    const auth = await getAccountAuthStatus(true);
    if (!['signed_in', 'signed_out'].includes(auth.status)) {
      throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
    }
    return auth.status === 'signed_in';
  }

  async function loadMoreVideos() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    const control = ensureHomeLoadSentinel();
    const status = control.querySelector('.home-load-status');
    status.textContent = '読み込み中…';
    const existingIds = new Set($$('.video-card[data-video-id], .home-short-card[data-video-id]').map(card => card.dataset.videoId));
    let requestSucceeded = false;
    try {
      await syncRecommendationAuth();
      const response = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recommendationPayload([...existingIds]))
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'おすすめを取得できませんでした。');
      const authenticated = document.body.dataset.authenticated === 'true';
      if (Boolean(result.authenticated) !== authenticated) {
        throw new Error('ログイン状態が変わりました。ページを再読み込みしてください。');
      }
      if (authenticated && result.source !== 'account') {
        throw new Error('ログイン中のおすすめにGoogleアカウント以外のデータが含まれていました。');
      }
      const videos = [];
      for (const video of result.videos || []) {
        if (!video?.id || existingIds.has(video.id)) continue;
        existingIds.add(video.id);
        videos.push(video);
      }
      if (videos.length) grid.insertAdjacentHTML('beforeend', videos.map(renderCard).join(''));

      const cache = authenticated ? { videos:[], shorts:[] } : safeJson('recommendationCache', { videos: [], shorts: [] });
      const cachedIds = new Set((cache.videos || []).map(video => video.id));
      cache.videos = [...(cache.videos || []), ...videos.filter(video => !cachedIds.has(video.id))];
      const shorts = [];
      for (const video of result.shorts || []) {
        if (!video?.id || existingIds.has(video.id)) continue;
        existingIds.add(video.id);
        shorts.push(video);
      }
      if (shorts.length) {
        const shelfVideos = [...loadedShorts, ...shorts];
        const uniqueShorts = [...new Map(shelfVideos.map(video => [video.id, video])).values()];
        cache.shorts = uniqueShorts;
        paintShortsShelf(uniqueShorts);
      }
      cache.savedAt = Date.now();
      if (authenticated) localStorage.removeItem('recommendationCache');
      else {
        cache.authenticated = false;
        saveJson('recommendationCache', cache);
      }
      const addedCount = videos.length + shorts.length;
      hasMore = Boolean(result.hasMore && addedCount);
      status.textContent = addedCount ? '' : 'これ以上のおすすめはありません';
      requestSucceeded = true;
      if (hasMore && loadMoreObserver) {
        loadMoreObserver.unobserve(control);
        loadMoreIntersecting = false;
        requestAnimationFrame(() => loadMoreObserver.observe(control));
      }
    } catch (error) {
      status.textContent = error.message || 'おすすめを読み込めませんでした';
      hasMore = true;
    } finally {
      loadingMore = false;
      control.hidden = !hasMore && !status.textContent;
      if (requestSucceeded && hasMore && !control.hidden && control.getBoundingClientRect().top < window.innerHeight + 700) {
        requestAnimationFrame(() => loadMoreVideos());
      }
    }
  }

  async function loadHomeVideos(force = false) {
    let isAuth;
    try {
      isAuth = await syncRecommendationAuth();
    } catch (error) {
      grid.innerHTML = `<div class="empty"><h2>${esc(error.message || 'アカウント状態を確認できませんでした')}</h2></div>`;
      hasMore = false;
      ensureHomeLoadSentinel();
      return;
    }
    const cached = safeJson('recommendationCache', null);

    if (!isAuth && !force && cached?.authenticated === false && cached?.videos?.length && Date.now() - (cached.savedAt || 0) < 300000) {
      grid.innerHTML = cached.videos.map(renderCard).join('');
      paintShortsShelf(cached.shorts || []);
      hasMore = true;
      ensureHomeLoadSentinel();
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

    const payload = recommendationPayload();

    try {
      const res = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'おすすめを取得できませんでした。');
        if (Boolean(result.authenticated) !== isAuth) {
          throw new Error('ログイン状態が変わりました。ページを再読み込みしてください。');
        }
        if (isAuth && result.source !== 'account') {
          throw new Error('ログイン中のおすすめにGoogleアカウント以外のデータが含まれていました。');
        }
        return result;
      });

      if (res.videos?.length || res.shorts?.length) {
        grid.innerHTML = (res.videos || []).map(renderCard).join('');
        paintShortsShelf(res.shorts || []);
        hasMore = Boolean(res.hasMore ?? (res.videos?.length || res.shorts?.length));
        if (isAuth) localStorage.removeItem('recommendationCache');
        else saveJson('recommendationCache', {
          authenticated: false,
          savedAt: Date.now(),
          videos: res.videos || [],
          shorts: res.shorts || []
        });
        ensureHomeLoadSentinel();
      } else {
        grid.innerHTML = `<div class="empty"><h2>${esc(res.error || 'おすすめ動画がありません')}</h2></div>`;
        hasMore = false;
        ensureHomeLoadSentinel();
      }
    } catch (error) {
      hasMore = false;
      if (!isAuth && cached?.authenticated === false && cached?.videos?.length) {
        grid.innerHTML = cached.videos.map(renderCard).join('');
        paintShortsShelf(cached.shorts || []);
        const control = ensureHomeLoadSentinel();
        control.querySelector('.home-load-status').textContent = '更新に失敗したため、保存済みのおすすめを表示しています。';
      } else {
        grid.innerHTML = `<div class="empty"><h2>${esc(error.message || 'おすすめを取得できませんでした')}</h2></div>`;
        ensureHomeLoadSentinel();
      }
    }
  }

  document.addEventListener('wetube:auth-changed', () => {
    localStorage.removeItem('recommendationCache');
    loadHomeVideos(true);
  });

  loadHomeVideos();
})();
