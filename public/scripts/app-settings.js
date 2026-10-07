(() => {
  const saveStatus = $('#settingsSaveStatus');
  const setting = (key, fallback) => localStorage.getItem(key) ?? fallback;
  const faviconPresets = {
    classroom: 'https://classroom.google.com',
    google: 'https://google.com',
    eigosapuri: 'https://app.eigosapuri.jp'
  };
  const defaultFavicon = '/images/YouTube-Logo-Vector.png';
  const googleFavicon = siteUrl => {
    const site = new URL(siteUrl);
    const api = new URL('https://www.google.com/s2/favicons');
    api.searchParams.set('domain', site.hostname);
    api.searchParams.set('sz', '64');
    return api.href;
  };
  const faviconForSite = siteUrl => {
    if (!siteUrl) return '';
    try {
      const site = new URL(siteUrl);
      if (site.protocol !== 'https:' || site.username || site.password) return '';
      return googleFavicon(site.href);
    } catch {
      return '';
    }
  };
  const faviconLink = $('#siteFavicon');
  const setFavicon = siteUrl => {
    if (!faviconLink) return;
    const faviconUrl = faviconForSite(siteUrl);
    if (!faviconUrl) {
      faviconLink.href = defaultFavicon;
      faviconLink.type = 'image/png';
      return;
    }
    faviconLink.removeAttribute('type');
    faviconLink.href = faviconUrl;
  };
  setFavicon(setting('siteFaviconUrl', ''));
  window.addEventListener('storage', event => {
    if (event.key === 'siteFaviconUrl') setFavicon(event.newValue || '');
    if (event.key === 'siteTabName') applyTabName(event.newValue || '');
  });
  const defaultTabName = document.title;
  const applyTabName = name => {
    const title = name || defaultTabName;
    if (document.title !== title) document.title = title;
  };
  applyTabName(setting('siteTabName', ''));
  const titleElement = document.querySelector('title');
  if (titleElement) {
    new MutationObserver(() => {
      const configuredName = setting('siteTabName', '');
      if (configuredName) applyTabName(configuredName);
    }).observe(titleElement, { childList: true, characterData: true, subtree: true });
  }
  const applyVisualSettings = () => {
    document.body.classList.toggle('compact-video-grid', setting('compactVideoGrid', 'false') === 'true');
    document.body.classList.toggle('reduce-motion', setting('reduceMotion', 'false') === 'true');
    document.body.classList.toggle('watch-independent-scroll', setting('independentWatchScroll', 'false') === 'true');
  };
  applyVisualSettings();

  if (document.body.dataset.page !== 'settings') return;

  const playbackSelect = $('#settingsDefaultPlayer');
  const autoplayToggle = $('#settingsAutoplay');
  const playbackSpeed = $('#settingsPlaybackSpeed');
  const previewsToggle = $('#settingsVideoPreviews');
  const compactToggle = $('#settingsCompactGrid');
  const motionToggle = $('#settingsReduceMotion');
  const independentWatchScrollToggle = $('#settingsIndependentWatchScroll');
  const faviconPreset = $('#settingsFaviconPreset');
  const faviconUrl = $('#settingsFaviconUrl');
  const faviconApply = $('#settingsFaviconApply');
  const faviconPreview = $('#settingsFaviconPreview');
  const tabNameInput = $('#settingsTabName');
  const tabNameApply = $('#settingsTabNameApply');
  const tabNameReset = $('#settingsTabNameReset');
  const navigationUrlInput = $('#settingsNavigationUrl');
  const navigationKeyInput = $('#settingsNavigationKey');
  const navigationSave = $('#settingsNavigationSave');
  const legacyMode = localStorage.getItem('playerMode') || '';
  const storedMode = localStorage.getItem('defaultPlayerMode') ||
    (legacyMode.startsWith('edu:') ? 'edu' : legacyMode);

  if (playbackSelect) {
    playbackSelect.value = ['edu', 'youtube', 'nocookie', 'stream'].includes(storedMode) ? storedMode : 'edu';
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

  if (independentWatchScrollToggle) {
    independentWatchScrollToggle.checked = setting('independentWatchScroll', 'false') === 'true';
    independentWatchScrollToggle.addEventListener('change', () => {
      localStorage.setItem('independentWatchScroll', String(independentWatchScrollToggle.checked));
      applyVisualSettings();
      if (saveStatus) saveStatus.textContent = '動画ページのスクロール設定を保存しました。';
    });
  }

  if (faviconPreset && faviconUrl && faviconApply) {
    const savedFaviconUrl = setting('siteFaviconUrl', '');
    const savedHost = (() => {
      try { return new URL(savedFaviconUrl).hostname; } catch { return ''; }
    })();
    const savedPreset = Object.entries(faviconPresets).find(([, url]) => new URL(url).hostname === savedHost)?.[0];
    faviconPreset.value = savedFaviconUrl ? savedPreset || 'custom' : 'default';
    faviconUrl.value = savedFaviconUrl && !savedPreset ? savedFaviconUrl : '';
    faviconUrl.disabled = faviconPreset.value !== 'custom';
    faviconApply.disabled = faviconPreset.value !== 'custom';
    if (faviconPreview) faviconPreview.src = faviconForSite(savedFaviconUrl) || defaultFavicon;

    faviconPreset.addEventListener('change', () => {
      const selected = faviconPreset.value;
      const url = faviconPresets[selected] || '';
      const isCustom = selected === 'custom';
      faviconUrl.disabled = !isCustom;
      faviconApply.disabled = !isCustom;
      if (selected === 'default' || url) {
        localStorage.setItem('siteFaviconUrl', url);
        setFavicon(url);
        if (faviconPreview) faviconPreview.src = faviconForSite(url) || defaultFavicon;
        if (saveStatus) saveStatus.textContent = selected === 'default'
          ? 'サイトのアイコンを既定に戻しました。'
          : 'サイトのアイコンを変更しました。';
      }
    });
    faviconUrl.addEventListener('input', () => {
      if (faviconPreset.value !== 'custom') faviconPreset.value = 'custom';
      faviconUrl.disabled = false;
      faviconApply.disabled = false;
    });
    faviconApply.addEventListener('click', () => {
      let parsed;
      try {
        parsed = new URL(faviconUrl.value.trim());
      } catch {
        if (saveStatus) saveStatus.textContent = '有効なサイトURLを入力してください。';
        return;
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        if (saveStatus) saveStatus.textContent = '取得元にするサイトのHTTPS URLを入力してください。';
        return;
      }
      const url = parsed.origin;
      localStorage.setItem('siteFaviconUrl', url);
      setFavicon(url);
      if (faviconPreview) faviconPreview.src = faviconForSite(url) || defaultFavicon;
      if (saveStatus) saveStatus.textContent = 'サイトのアイコン取得元を保存しました。';
    });
  }

  if (tabNameInput && tabNameApply && tabNameReset) {
    tabNameInput.value = setting('siteTabName', '');
    tabNameApply.addEventListener('click', () => {
      const enteredName = tabNameInput.value.slice(0, 60);
      const name = enteredName.trim() ? enteredName : '';
      localStorage.setItem('siteTabName', name);
      applyTabName(name);
      if (saveStatus) saveStatus.textContent = name ? 'タブ名を保存しました。' : '既定のタブ名に戻しました。';
    });
    tabNameReset.addEventListener('click', () => {
      localStorage.removeItem('siteTabName');
      tabNameInput.value = '';
      applyTabName('');
      if (saveStatus) saveStatus.textContent = '既定のタブ名に戻しました。';
    });
  }

  if (navigationUrlInput && navigationKeyInput && navigationSave) {
    navigationUrlInput.value = setting('navigationUrl', '');
    let savedKeys;
    try {
      const parsedKeys = JSON.parse(setting('navigationKeys', 'null'));
      savedKeys = Array.isArray(parsedKeys) ? parsedKeys : [setting('navigationKey', '[')];
    } catch {
      savedKeys = [setting('navigationKey', '[')];
    }
    navigationKeyInput.value = savedKeys.join(', ');
    navigationSave.addEventListener('click', () => {
      const urlText = navigationUrlInput.value.trim();
      const keys = navigationKeyInput.value.split(',').map(key => key.trim());
      let target = null;
      try {
        target = new URL(urlText);
      } catch {
        if (saveStatus) saveStatus.textContent = '有効な移動先URLを入力してください。';
        return;
      }
      if (!['http:', 'https:'].includes(target.protocol)) {
        if (saveStatus) saveStatus.textContent = '移動先URLにはHTTPまたはHTTPSを指定してください。';
        return;
      }
      if (!keys.length || keys.some(key => key.length !== 1) || new Set(keys).size !== keys.length) {
        if (saveStatus) saveStatus.textContent = '移動キーは重複しない1文字をカンマ区切りで指定してください。';
        return;
      }
      localStorage.setItem('navigationUrl', target.href);
      localStorage.setItem('navigationKeys', JSON.stringify(keys));
      localStorage.setItem('navigationKey', keys[0]);
      if (saveStatus) saveStatus.textContent = '移動先URLとキーを保存しました。';
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
      playbackSelect.value = ['edu', 'youtube', 'nocookie', 'stream'].includes(event.newValue) ? event.newValue : 'edu';
    }
    if (event.key === 'autoplay' && autoplayToggle) autoplayToggle.checked = event.newValue !== 'false';
    if (event.key === 'playbackSpeed' && playbackSpeed) playbackSpeed.value = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2'].includes(event.newValue) ? event.newValue : '1';
    if (event.key === 'videoPreviews' && previewsToggle) previewsToggle.checked = event.newValue === 'true';
    if (event.key === 'compactVideoGrid' && compactToggle) compactToggle.checked = event.newValue === 'true';
    if (event.key === 'compactVideoGrid' || event.key === 'reduceMotion') applyVisualSettings();
    if (event.key === 'reduceMotion' && motionToggle) motionToggle.checked = event.newValue === 'true';
    if (event.key === 'independentWatchScroll') {
      applyVisualSettings();
      if (independentWatchScrollToggle) independentWatchScrollToggle.checked = event.newValue === 'true';
    }
  });
})();
