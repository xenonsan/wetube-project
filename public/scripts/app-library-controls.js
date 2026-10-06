// --- Library: Refresh Button & Filter Chips ---
(() => {
  if (document.body.dataset.page !== 'library') return;

  // Refresh button
  document.getElementById('refreshLibrary')?.addEventListener('click', () => {
    location.reload();
  });

  // Filter chips (all / recent)
  document.querySelectorAll('[data-library-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-library-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.libraryFilter;
      const grid = document.getElementById('libraryGrid');
      if (!grid) return;
      const cards = [...grid.querySelectorAll('.video-card, .subscription-card')];
      cards.forEach((card, i) => {
        card.hidden = filter === 'recent' ? i >= 10 : false;
      });
    });
  });
})();
