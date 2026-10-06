// --- Theme Management (Device / Dark / Light) ---
(() => {
  const root = document.documentElement;
  const themePref = localStorage.getItem('themePreference') || 'device';
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(pref) {
    let activeTheme = pref;
    if (pref === 'device') {
      activeTheme = systemDark.matches ? 'dark' : 'light';
    }
    root.dataset.theme = activeTheme;
    root.style.colorScheme = activeTheme;
    const label = $('#currentThemeLabel');
    if (label) {
      label.textContent = pref === 'device' ? 'システム既定' : pref === 'dark' ? 'ダーク' : 'ライト';
    }
    const radios = $$('input[name="themeSelect"], input[name="settingsThemeSelect"]');
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

  $$('input[name="themeSelect"], input[name="settingsThemeSelect"]').forEach(input => {
    input.addEventListener('change', e => {
      const selected = e.target.value;
      localStorage.setItem('themePreference', selected);
      applyTheme(selected);
      if (themeDialog && themeDialog.contains(input)) {
        setTimeout(() => { themeDialog.hidden = true; }, 180);
      }
    });
  });

  themeDialog?.querySelector('.modal-close')?.addEventListener('click', () => {
    themeDialog.hidden = true;
  });
})();
