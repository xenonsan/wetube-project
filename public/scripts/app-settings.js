(() => {
  const saveStatus = $('#settingsSaveStatus');
  const setting = (key, fallback) => localStorage.getItem(key) ?? fallback;
  const applyVisualSettings = () => {
    document.body.classList.toggle('compact-video-grid', setting('compactVideoGrid', 'false') === 'true');
    document.body.classList.toggle('reduce-motion', setting('reduceMotion', 'false') === 'true');
  };
  applyVisualSettings();

  if (document.body.dataset.page !== 'settings') return;

  const playbackSelect = $('#settingsDefaultPlayer');
  const autoplayToggle = $('#settingsAutoplay');
  const playbackSpeed = $('#settingsPlaybackSpeed');
  const previewsToggle = $('#settingsVideoPreviews');
  const compactToggle = $('#settingsCompactGrid');
  const motionToggle = $('#settingsReduceMotion');
  const legacyMode = localStorage.getItem('playerMode') || '';
  const storedMode = localStorage.getItem('defaultPlayerMode') ||
    (legacyMode.startsWith('edu:') ? 'edu' : legacyMode);

  if (playbackSelect) {
    playbackSelect.value = ['edu', 'youtube', 'stream'].includes(storedMode) ? storedMode : 'edu';
    playbackSelect.addEventListener('change', () => {
      localStorage.setItem('defaultPlayerMode', playbackSelect.value);
      if (saveStatus) saveStatus.textContent = '既定の再生方法を保存しました。';
    });
  }

  if (autoplayToggle) {
    autoplayToggle.checked = localStorage.getItem('autoplay') !== 'false';
    autoplayToggle.addEventListener('change', () => {
      localStorage.setItem('autoplay', String(autoplayToggle.checked));
      if (saveStatus) saveStatus.textContent = '自動再生の設定を保存しました。';
    });
  }

  if (playbackSpeed) {
    playbackSpeed.value = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2'].includes(setting('playbackSpeed', '1'))
      ? setting('playbackSpeed', '1')
      : '1';
    playbackSpeed.addEventListener('change', () => {
      localStorage.setItem('playbackSpeed', playbackSpeed.value);
      if (saveStatus) saveStatus.textContent = '再生速度を保存しました。次の動画から適用されます。';
    });
  }
  if (previewsToggle) {
    previewsToggle.checked = setting('videoPreviews', 'false') === 'true';
    previewsToggle.addEventListener('change', () => {
      localStorage.setItem('videoPreviews', String(previewsToggle.checked));
      if (saveStatus) saveStatus.textContent = '動画プレビューの設定を保存しました。';
    });
  }
  if (compactToggle) {
    compactToggle.checked = setting('compactVideoGrid', 'false') === 'true';
    compactToggle.addEventListener('change', () => {
      localStorage.setItem('compactVideoGrid', String(compactToggle.checked));
      applyVisualSettings();
      if (saveStatus) saveStatus.textContent = '一覧表示の設定を保存しました。';
    });
  }
  if (motionToggle) {
    motionToggle.checked = setting('reduceMotion', 'false') === 'true';
    motionToggle.addEventListener('change', () => {
      localStorage.setItem('reduceMotion', String(motionToggle.checked));
      applyVisualSettings();
      if (saveStatus) saveStatus.textContent = 'アニメーションの設定を保存しました。';
    });
  }

  const clearLocalData = (buttonId, storageKey, label) => {
    $(`#${buttonId}`)?.addEventListener('click', () => {
      if (!window.confirm(`${label}をこのブラウザから削除しますか？`)) return;
      localStorage.removeItem(storageKey);
      if (saveStatus) saveStatus.textContent = `${label}を削除しました。`;
    });
  };
  clearLocalData('clearSearchHistory', 'searchHistory', '検索履歴');
  clearLocalData('clearLocalHistory', 'history', '視聴履歴');
  clearLocalData('clearPlaybackQueue', 'queue', '再生キュー');

  window.addEventListener('storage', event => {
    if (event.key === 'defaultPlayerMode' && playbackSelect) {
      playbackSelect.value = ['edu', 'youtube', 'stream'].includes(event.newValue) ? event.newValue : 'edu';
    }
    if (event.key === 'autoplay' && autoplayToggle) autoplayToggle.checked = event.newValue !== 'false';
    if (event.key === 'playbackSpeed' && playbackSpeed) playbackSpeed.value = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2'].includes(event.newValue) ? event.newValue : '1';
    if (event.key === 'videoPreviews' && previewsToggle) previewsToggle.checked = event.newValue === 'true';
    if (event.key === 'compactVideoGrid' && compactToggle) compactToggle.checked = event.newValue === 'true';
    if (event.key === 'compactVideoGrid' || event.key === 'reduceMotion') applyVisualSettings();
    if (event.key === 'reduceMotion' && motionToggle) motionToggle.checked = event.newValue === 'true';
  });
})();
