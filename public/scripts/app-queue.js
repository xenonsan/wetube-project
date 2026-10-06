// --- Queue Panel ---
(() => {
  const panel = $('#queuePanel');
  const queueList = $('#queueList');
  const queueBtn = $('#queueButton');
  const closeQueue = $('#closeQueue');
  const clearQueue = $('#clearQueue');
  if (!panel) return;

  function renderQueue() {
    if (!queueList) return;
    if (document.body.dataset.authenticated === 'true') {
      queueList.innerHTML = '<div class="queue-empty">ログイン中はGoogleアカウントのデータのみ使用するため、ローカルキューは利用できません</div>';
      return;
    }
    const ids = safeJson('queue', []);
    if (!ids.length) {
      queueList.innerHTML = '<div class="queue-empty">キューは空です</div>';
      return;
    }
    // Show video IDs as links; enrich async if possible
    queueList.innerHTML = ids.map((id, i) => `
      <a class="queue-item" href="/watch?v=${esc(id)}">
        <img class="queue-item-thumb" src="https://i.ytimg.com/vi/${esc(id)}/mqdefault.jpg" alt="" loading="lazy">
        <div class="queue-item-info">
          <div class="queue-item-title">${esc(id)}</div>
          <div class="queue-item-channel">キューの動画 ${i + 1}</div>
        </div>
      </a>
    `).join('');
    // Async enrich titles
    ids.slice(0, 20).forEach(async (id, i) => {
      try {
        const res = await fetch('/api/videos?ids=' + encodeURIComponent(id)).then(r => r.json());
        const v = res.videos?.[0];
        if (!v) return;
        const item = queueList.children[i];
        if (!item) return;
        const title = item.querySelector('.queue-item-title');
        const channel = item.querySelector('.queue-item-channel');
        if (title) title.textContent = v.title;
        if (channel) channel.textContent = v.author;
      } catch {}
    });
  }

  function openQueue() {
    document.body.classList.add('queue-open');
    renderQueue();
  }

  function closeQueuePanel() {
    document.body.classList.remove('queue-open');
  }

  queueBtn?.addEventListener('click', () => {
    if (document.body.classList.contains('queue-open')) {
      closeQueuePanel();
    } else {
      openQueue();
    }
  });

  closeQueue?.addEventListener('click', closeQueuePanel);

  clearQueue?.addEventListener('click', () => {
    if (document.body.dataset.authenticated === 'true') {
      notify('ログイン中はGoogleアカウントのデータのみ使用するため、ローカルキューは利用できません。');
      return;
    }
    saveJson('queue', []);
    renderQueue();
    notify('キューを消去しました');
  });

  // Close when clicking outside
  document.addEventListener('click', e => {
    if (document.body.classList.contains('queue-open') &&
        !e.target.closest('#queuePanel') &&
        !e.target.closest('#queueButton')) {
      closeQueuePanel();
    }
  });
})();
