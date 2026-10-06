// --- Top Loading Progress Bar ---
(() => {
  const bar = $('#pageProgress')?.firstElementChild;
  if (!bar) return;
  let val = 0, frame = 0, finishing = false;

  function step() {
    val += (finishing ? 100 - val : 85 - val) * 0.15;
    bar.style.transform = `scaleX(${val / 100})`;
    if (finishing && val > 99) {
      bar.style.opacity = '0';
      cancelAnimationFrame(frame);
      return;
    }
    frame = requestAnimationFrame(step);
  }

  function start() {
    cancelAnimationFrame(frame);
    val = 10;
    finishing = false;
    bar.style.opacity = '1';
    frame = requestAnimationFrame(step);
  }

  function finish() {
    finishing = true;
  }

  start();
  if (document.readyState === 'complete') finish();
  else window.addEventListener('load', finish, { once: true });

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin && url.href !== location.href) {
      start();
    }
  });
})();
