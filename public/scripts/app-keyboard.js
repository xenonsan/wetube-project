// --- Global Keyboard Shortcuts (non-watch-page) ---
(() => {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;

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
