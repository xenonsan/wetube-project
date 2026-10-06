// --- Shorts Reel Controller ---
(() => {
  if (document.body.dataset.page !== 'shorts') return;

  const feed = $('#shortsFeed');
  let reels = $$('.short-reel');
  const panel = $('#shortComments');
  const commentsScrim = $('#shortCommentsScrim');
  const list = $('#shortCommentsList');
  if (!feed || !reels.length) return;

  let activeIndex = 0;
  let loading = false;
  let hasMore = Boolean(feed.dataset.shortToken);
  const token = feed.dataset.shortToken || '';
  let currentCommentId = '';
  let activeReel = null;
  let activePlaybackSessionId = '';

  function closeShortComments() {
    document.body.classList.remove('short-comments-open');
    panel?.classList.remove('open');
    panel?.setAttribute('aria-hidden', 'true');
    if (commentsScrim) commentsScrim.hidden = true;
  }

  function activateShort(reel, idx) {
    if (!reel) return;
    if (activeReel !== reel) {
      activeReel = reel;
      activePlaybackSessionId = newPlaybackSessionId();
    }
    activeIndex = idx;
    reels.forEach((item, itemIdx) => {
      item.classList.toggle('is-active', itemIdx === idx);
      const frame = item.querySelector('.short-player');
      if (itemIdx === idx) {
        if (frame.dataset.src && !frame.getAttribute('src')) frame.setAttribute('src', frame.dataset.src);
      } else {
        frame.removeAttribute('src');
      }
    });

    const shortId = reel.dataset.shortId;
    recordHistoryForCurrentAccount(shortId);
    recordAccountWatch(shortId, activePlaybackSessionId);
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
              <iframe class="short-player" data-src="${esc(short.eduUrl || '')}" title="${esc(short.title || '')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
              <div class="short-overlay">
                <a href="${short.authorId ? '/channel/' + encodeURIComponent(short.authorId) : '#'}" class="short-author">
                  ${short.authorThumbnail ? `<img src="${esc(short.authorThumbnail)}" alt="">` : `<span class="fallback">${esc(short.author.slice(0, 1))}</span>`}
                  <b>${esc(short.author)}</b>
                </a>
                <p>${esc(short.title)}</p>
              </div>
            </div>
            <div class="short-actions">
              <button class="short-like" type="button" aria-label="高評価"><svg class="icon"><use href="#i-like"></use></svg><span>高評価</span></button>
              <button class="short-comment" type="button" aria-label="コメント"><svg class="icon"><use href="#i-news"></use></svg><span>コメント</span></button>
              <button class="short-share" type="button" aria-label="共有"><svg class="icon"><use href="#i-share"></use></svg><span>共有</span></button>
              <a href="/watch?v=${encodeURIComponent(short.id)}" aria-label="通常再生"><svg class="icon"><use href="#i-screen"></use></svg><span>通常再生</span></a>
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
    if (e.key === 'Escape' && document.body.classList.contains('short-comments-open')) {
      e.preventDefault();
      closeShortComments();
      return;
    }
    if (document.body.classList.contains('short-comments-open')) return;
    if (isShortcutBlocked(e)) return;
    if (['ArrowDown', 'j'].includes(e.key)) { e.preventDefault(); move(1); }
    if (['ArrowUp', 'k'].includes(e.key)) { e.preventDefault(); move(-1); }
  });

  // Short Actions: Like, Comment, Save, Share
  feed.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const reel = target.closest('.short-reel');
    if (!reel) return;
    const id = reel.dataset.shortId;

    if (target.closest('.short-like')) {
      const btn = reel.querySelector('.short-like');
      const active = btn?.classList.contains('active');
      try {
        const auth = await getAccountAuthStatus(true);
        if (auth.status === 'signed_in') {
          btn.disabled = true;
          try {
            const response = await fetch('/api/interact', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: active ? 'removeRating' : 'like', videoId: id })
            });
            const data = await response.json();
            if (!response.ok || data.ok !== true || typeof data.liked !== 'boolean') {
              throw new Error(data.error || '高評価を更新できませんでした。');
            }
            btn.classList.toggle('active', data.liked);
            notify(data.liked ? '高評価しました' : '高評価を取り消しました');
          } catch (error) {
            notify(error.message || '高評価を更新できませんでした。');
          } finally {
            btn.disabled = false;
          }
        } else if (auth.status === 'signed_out') {
          const likedVideos = safeJson('likedVideos', []);
          const next = active ? likedVideos.filter(video => video !== id) : [id, ...likedVideos];
          saveJson('likedVideos', next);
          btn?.classList.toggle('active', !active);
          notify(!active ? '高評価しました' : '高評価を取り消しました');
        } else {
          throw new Error(auth.error || 'アカウント状態を確認できませんでした。');
        }
      } catch (error) {
        notify(error.message || '高評価を更新できませんでした。');
      }
    }

    if (target.closest('.short-share')) {
      const url = `${location.origin}/shorts/${id}`;
      try {
        if (navigator.share) await navigator.share({ title: document.title, url });
        else throw new Error('share unavailable');
      } catch {
        try {
          await navigator.clipboard.writeText(url);
          notify('リンクをコピーしました');
        } catch {
          notify('共有リンクをコピーできませんでした。');
        }
      }
    }

    if (target.closest('.short-comment')) {
      currentCommentId = id;
      document.body.classList.add('short-comments-open');
      panel?.classList.add('open');
      panel?.setAttribute('aria-hidden', 'false');
      if (commentsScrim) commentsScrim.hidden = false;
      loadShortComments(id);
    }
  });

  $('#closeShortComments')?.addEventListener('click', closeShortComments);
  commentsScrim?.addEventListener('click', closeShortComments);
  panel?.addEventListener('click', event => {
    const button = event.target.closest('[data-short-sort]');
    if (!button || !currentCommentId || button.classList.contains('active')) return;
    panel.querySelectorAll('[data-short-sort]').forEach(option => option.classList.toggle('active', option === button));
    loadShortComments(currentCommentId, button.dataset.shortSort);
  });

  async function loadShortComments(id, sort = panel?.querySelector('[data-short-sort].active')?.dataset.shortSort || 'top') {
    if (!list) return;
    list.innerHTML = '<p class="muted">読み込み中…</p>';
    try {
      const res = await fetch(`/api/comments?v=${encodeURIComponent(id)}&sort=${encodeURIComponent(sort)}`).then(r => r.json());
      if (!Array.isArray(res.comments)) throw new Error(res.error || 'コメントを取得できませんでした。');
      list.innerHTML = res.comments.map(c => `
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
  $('#shortCommentComposer')?.addEventListener('submit', async event => {
    event.preventDefault();
    const text = $('#shortCommentText')?.value.trim() || '';
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (!currentCommentId || !text || !submit) return;
    submit.disabled = true;
    try {
      const response = await fetch('/api/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'comment', videoId: currentCommentId, text })
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'コメントを投稿できませんでした。');
      $('#shortCommentText').value = '';
      notify('コメントを投稿しました');
      await loadShortComments(currentCommentId);
    } catch (error) {
      notify(error.message || 'コメントを投稿できませんでした。');
    } finally {
      submit.disabled = false;
    }
  });

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
  document.addEventListener('wetube:auth-changed', event => {
    if (!event.detail?.authenticated) return;
    const activeShortId = reels[activeIndex]?.dataset.shortId;
    if (activeShortId && activePlaybackSessionId) recordAccountWatch(activeShortId, activePlaybackSessionId);
  });
})();
