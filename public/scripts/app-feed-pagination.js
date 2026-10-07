(() => {
  const relatedRoot = document.querySelector('.related');
  const hydrateRelatedDurations = cards => {
    const missing = cards.filter(card => card.querySelector('.related-thumb') && !card.querySelector('.related-thumb .duration'));
    const ids = [...new Set(missing.map(card => card.dataset.videoId).filter(id => /^[\w-]{11}$/.test(id || '')))];
    if (!ids.length) return;
    fetch(`/api/videos?ids=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '関連動画の再生時間を取得できませんでした。');
        const durations = new Map((result.videos || []).map(video => [video.id, video.duration]));
        for (const card of missing) {
          const duration = durations.get(card.dataset.videoId);
          const thumb = card.querySelector('.related-thumb');
          if (duration && thumb && !thumb.querySelector('.duration')) {
            const badge = document.createElement('span');
            badge.className = 'duration';
            badge.textContent = duration;
            thumb.append(badge);
          }
        }
      })
      .catch(error => console.warn('Hydrate related video durations:', error?.message || error));
  };
  if (relatedRoot) {
    hydrateRelatedDurations(Array.from(relatedRoot.querySelectorAll('.related-card-wrap')));
  }

  const root = document.querySelector('[data-feed-token]');
  if (!root) return;

  const token = root.dataset.feedToken;
  const kind = root.dataset.feedKind;
  const list = kind === 'related' ? root.querySelector('.related-list') : root;
  if (!list) return;
  const scrollRoot = kind === 'related' &&
    document.body.classList.contains('watch-independent-scroll') &&
    !document.body.classList.contains('theater') &&
    window.matchMedia('(min-width: 901px)').matches
    ? root
    : null;

  const existingCards = kind === 'search'
    ? document.querySelectorAll('#searchResults [data-video-id], .search-shorts-shelf [data-video-id]')
    : list.querySelectorAll('[data-video-id]');
  const seen = new Set(Array.from(existingCards, item => item.dataset.videoId));
  const controls = document.createElement('div');
  controls.className = 'feed-pagination';
  const status = document.createElement('span');
  status.className = 'feed-pagination-status';
  status.setAttribute('role', 'status');
  controls.append(status);
  root.append(controls);

  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  };
  const image = (src, className, alt = '', fallbackId = '') => {
    const node = element('img', className);
    node.src = src || '';
    node.alt = alt;
    node.loading = 'lazy';
    if (fallbackId) node.dataset.videoFallback = fallbackId;
    return node;
  };
  const moreButton = (video, related = false) => {
    const button = element('button', `more-btn${related ? ' related-more-btn' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', 'その他のアクション');
    button.dataset.videoId = video.id;
    button.dataset.title = video.title || '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-more');
    svg.append(use);
    button.append(svg);
    return button;
  };
  const createVideo = video => {
    if (!/^[\w-]{11}$/.test(String(video.id || ''))) return null;
    const isShort = video.isShort === true;
    if (isShort && kind === 'search') {
      let shelf = document.querySelector('.search-shorts-shelf');
      if (!shelf) {
        shelf = element('section', 'search-shorts-shelf');
        shelf.setAttribute('aria-label', 'Shorts検索結果');
        const heading = element('div', 'search-shorts-heading');
        heading.append(element('h2', '', 'Shorts'));
        shelf.append(heading, element('div', 'search-shorts-row'));
        root.parentElement.insertBefore(shelf, root);
      }
      const card = element('article', 'search-short-card');
      card.dataset.videoId = video.id;
      const link = element('a', 'search-short-thumb');
      link.href = `/shorts/${encodeURIComponent(video.id)}`;
      link.append(image(video.thumbnail, '', '', video.id));
      const badge = element('span', 'search-short-badge', 'Shorts');
      link.append(badge);
      const info = element('div', 'search-short-info');
      const title = element('a', 'video-title', video.title || 'ショート');
      title.href = link.href;
      info.append(title, element('span', '', [video.views, video.published].filter(Boolean).join('・')));
      if (video.authorId) {
        const channel = element('a', 'channel-name-link', video.author || 'チャンネル');
        channel.href = `/channel/${encodeURIComponent(video.authorId)}`;
        info.insertBefore(channel, info.lastChild);
      } else if (video.author) {
        info.insertBefore(element('span', '', video.author), info.lastChild);
      }
      card.append(link, info, moreButton(video));
      shelf.querySelector('.search-shorts-row').append(card);
      return card;
    }

    const card = kind === 'related' ? element('div', 'related-card-wrap') : element('article', 'video-card');
    card.dataset.videoId = video.id;
    if (kind === 'related') {
      const link = element('div', 'related-card');
      const videoHref = video.isShort ? `/shorts/${encodeURIComponent(video.id)}` : `/watch?v=${encodeURIComponent(video.id)}`;
      const thumbLink = element('a', 'related-thumb-link');
      thumbLink.href = videoHref;
      thumbLink.dataset.videoId = video.id;
      const thumb = element('div', 'related-thumb');
      thumb.append(image(video.thumbnail, '', '', video.id));
      if (video.isShort) thumb.append(element('span', 'shorts-video-badge', 'Shorts'));
      if (video.duration) thumb.append(element('span', 'duration', video.duration));
      thumbLink.append(thumb);
      const info = element('div', 'related-info');
      const title = element('a', 'related-title', video.title || '動画');
      title.href = videoHref;
      info.append(title);
      const channel = video.authorId ? element('a', 'related-channel', video.author || 'チャンネル不明') : element('span', 'related-channel', video.author || 'チャンネル不明');
      if (video.authorId) channel.href = `/channel/${encodeURIComponent(video.authorId)}`;
      info.append(channel, element('span', 'related-meta', video.views || '再生回数不明'));
      link.append(thumbLink, info);
      card.append(link, moreButton(video, true));
      return card;
    }

    const link = element('a', 'thumb');
    link.href = `/watch?v=${encodeURIComponent(video.id)}`;
    link.append(image(video.thumbnail, '', '', video.id));
    if (video.duration) link.append(element('span', 'duration', video.duration));
    const info = element('div', 'card-info');
    const avatar = video.authorThumbnail ? image(video.authorThumbnail, 'channel-avatar') : element('span', 'channel-avatar fallback', (video.author || 'Y').slice(0, 1));
    if (video.authorId) {
      const avatarLink = element('a', 'channel-avatar-link');
      avatarLink.href = `/channel/${encodeURIComponent(video.authorId)}`;
      avatarLink.append(avatar);
      info.append(avatarLink);
    } else {
      info.append(avatar);
    }
    const copy = element('div', 'card-copy');
    const title = element('a', 'video-title', video.title || '動画');
    title.href = link.href;
    copy.append(title);
    if (video.authorId) {
      const channel = element('a', 'channel-name-link', video.author || 'チャンネル');
      channel.href = `/channel/${encodeURIComponent(video.authorId)}`;
      copy.append(channel);
    } else {
      copy.append(element('span', '', video.author || 'チャンネル不明'));
    }
    copy.append(element('span', '', [video.views, video.published].filter(Boolean).join('・')));
    if (video.description) copy.append(element('p', '', video.description));
    info.append(copy);
    info.append(moreButton(video));
    card.append(link, info);
    return card;
  };

  let loading = false;
  let hasMore = true;
  let sentinelIntersecting = false;
  let emptyBatches = 0;
  const loadMore = async () => {
    if (loading || !hasMore) return;
    loading = true;
    status.textContent = '読み込み中…';
    try {
      const response = await fetch('/api/feed/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '動画を追加で読み込めませんでした。');
      let added = 0;
      for (const video of result.videos || []) {
        if (!video?.id || seen.has(video.id)) continue;
        const card = createVideo(video);
        if (!card) continue;
        seen.add(video.id);
        list.append(card);
        added++;
      }
      if (kind === 'related' && added) {
        hydrateRelatedDurations(Array.from(list.querySelectorAll('.related-card-wrap')).slice(-added));
      }
      hasMore = Boolean(result.hasMore);
      emptyBatches = added ? 0 : emptyBatches + 1;
      controls.hidden = !hasMore;
      status.textContent = hasMore && added === 0 ? '動画を読み込めませんでした。スクロールして再試行してください。' : '';
      const canRetryEmptyRelatedBatch = kind === 'related' && emptyBatches < 3;
      if (hasMore && (added > 0 || canRetryEmptyRelatedBatch) && observer) {
        observer.unobserve(controls);
        sentinelIntersecting = false;
        requestAnimationFrame(() => observer.observe(controls));
      }
      if (kind === 'related' && hasMore && (added > 0 || canRetryEmptyRelatedBatch)) {
        requestAnimationFrame(checkRelatedScrollPosition);
      }
    } catch (error) {
      status.textContent = error.message || '動画を追加で読み込めませんでした。';
    } finally {
      loading = false;
    }
  };
  let observer;
  let relatedScrollCheckScheduled = false;
  const nearBottom = element => element.scrollTop + element.clientHeight >= element.scrollHeight - 700;
  const checkRelatedScrollPosition = () => {
    if (relatedScrollCheckScheduled || loading || !hasMore) return;
    relatedScrollCheckScheduled = true;
    requestAnimationFrame(() => {
      relatedScrollCheckScheduled = false;
      const primary = document.querySelector('.watch-primary');
      if (scrollRoot && nearBottom(scrollRoot)) {
        loadMore();
      } else if (scrollRoot && primary && nearBottom(primary)) {
        loadMore();
      } else if (!scrollRoot && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 700) {
        loadMore();
      }
    });
  };
  const checkPosition = () => {
    const bounds = controls.getBoundingClientRect();
    if (scrollRoot) {
      const rootBounds = scrollRoot.getBoundingClientRect();
      if (bounds.top < rootBounds.bottom + 500 && bounds.bottom > rootBounds.top - 500) loadMore();
      return;
    }
    if (bounds.top < window.innerHeight + 500) loadMore();
  };
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      const isIntersecting = entries.some(entry => entry.isIntersecting);
      if (isIntersecting && !sentinelIntersecting) loadMore();
      sentinelIntersecting = isIntersecting;
    }, { root: scrollRoot, rootMargin: '500px 0px' });
    observer.observe(controls);
  } else {
    let scheduled = false;
    const schedulePositionCheck = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        checkPosition();
      });
    };
    (scrollRoot || window).addEventListener('scroll', schedulePositionCheck, { passive: true });
    window.addEventListener('resize', schedulePositionCheck, { passive: true });
    schedulePositionCheck();
  }
  if (kind === 'related' && !scrollRoot) {
    window.addEventListener('scroll', checkRelatedScrollPosition, { passive: true, capture: true });
    window.addEventListener('resize', checkRelatedScrollPosition, { passive: true });
    checkRelatedScrollPosition();
  } else if (kind === 'related' && scrollRoot) {
    const primary = document.querySelector('.watch-primary');
    scrollRoot.addEventListener('scroll', checkRelatedScrollPosition, { passive: true });
    primary?.addEventListener('scroll', checkRelatedScrollPosition, { passive: true });
    window.addEventListener('scroll', checkRelatedScrollPosition, { passive: true, capture: true });
  }
})();
