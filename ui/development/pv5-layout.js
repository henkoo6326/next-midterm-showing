/* Prototype dimensions only. Hardware-resolution evidence stays in pv5-research.md. */
(() => {
  'use strict';
  function applyPV5Layout() {
    if (document.body?.dataset.app !== 'delivery') return;
    const screens = [
      { id: 'center', width: 1280, height: 720, label: '12.9″ · 1280 × 720' },
      { id: 'cluster', width: 800, height: 400, label: '7.5″ · 800 × 400' }
    ];
    for (const screen of screens) {
      const device = document.getElementById(screen.id);
      const viewport = device?.closest('.screen-window');
      if (!viewport) continue;
      viewport.dataset.width = String(screen.width);
      viewport.dataset.height = String(screen.height);
      // The title belongs to the demo shell, outside the operational display.
      const shell = viewport.closest('.device-shell');
      const title = shell?.previousElementSibling;
      if (title?.classList.contains('device-title')) {
        const dimensions = title.querySelector('small');
        if (dimensions) dimensions.textContent = screen.label;
      }
    }
    // Adapter owns uniform fitting, map decoration, state, and future renders.
    window.NextApp?.render();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPV5Layout, { once: true });
  } else {
    applyPV5Layout();
  }
})();
