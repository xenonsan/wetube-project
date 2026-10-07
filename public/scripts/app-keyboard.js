// --- Global Keyboard Shortcuts (non-watch-page) ---
(() => {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;

    let navigationKeys;
    try {
      const storedKeys = JSON.parse(localStorage.getItem('navigationKeys') || 'null');
      navigationKeys = Array.isArray(storedKeys) ? storedKeys : [localStorage.getItem('navigationKey') || '['];
    } catch (error) {
      console.warn('Invalid configured navigation keys:', error);
      navigationKeys = [localStorage.getItem('navigationKey') || '['];
    }
    const navigationUrl = localStorage.getItem('navigationUrl') || '';
    if (navigationUrl && navigationKeys.includes(e.key) && !e.repeat &&
        !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
      try {
        const target = new URL(navigationUrl);
        if (target.protocol === 'http:' || target.protocol === 'https:') {
          e.preventDefault();
          document.documentElement.style.cssText = 'min-height:100%;background:#fff!important;';
          document.body.replaceChildren();
          document.body.style.cssText = 'min-height:100vh;margin:0;background:#fff!important;';
          requestAnimationFrame(() => window.location.assign(target.href));
          return;
        }
      } catch (error) {
        console.warn('Invalid configured navigation URL:', error);
      }
    }

    // Esc — close any open modal/popover/panel
    if (e.key === 'Escape') {
      // Modals
      for (const id of ['shortcutsDialog', 'themeDialog', 'streamInfoDialog', 'authDialog']) {
        const el = document.getElementById(id);
        if (el && !el.hidden) { el.hidden = true; return; }
      }
      // Popovers
      for (const id of ['notificationsPopover', 'accountMenuPopover', 'cardActionMenu', 'commentsSortMenu']) {
        const el = document.getElementById(id);
        if (el && !el.hidden) { el.hidden = true; return; }
      }
      // Queue panel
      if (document.body.classList.contains('queue-open')) {
        document.body.classList.remove('queue-open');
        return;
      }
      const miniExpand = document.getElementById('miniPlayerExpand');
      if (miniExpand && !document.getElementById('miniPlayer')?.hidden) {
        miniExpand.click();
        return;
      }
      // Shorts comments panel
      const shortComments = document.getElementById('shortComments');
      if (shortComments?.classList.contains('open')) {
        shortComments.classList.remove('open');
        shortComments.setAttribute('aria-hidden', 'true');
        return;
      }
      // Mobile menu
      document.body.classList.remove('mobile-menu-open', 'watch-sidebar-open');
    }

    // / — focus search bar globally
    if (e.key === '/' && document.body.dataset.page !== 'watch') {
      e.preventDefault();
      const inp = document.getElementById('searchInput');
      if (inp) { inp.focus(); inp.select(); }
    }
  });
})();
