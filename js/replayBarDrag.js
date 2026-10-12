/* Barra de replay flotante: arrastre por el asa ⠿ y posición recordada.
   Solo actúa en escritorio (> 820 px); en móvil la barra vuelve a su sitio en la
   columna y se borran las coordenadas en línea. Las coordenadas se guardan
   relativas a #chartArea, así que sobreviven a recargas y a cambios de tamaño
   (se vuelven a acotar dentro del área). */
(function () {
  const KEY = 'brp.replayBar.pos';
  const bar = document.getElementById('replayBar');
  const area = document.getElementById('chartArea');
  const grip = bar && bar.querySelector('.rb-grip');
  if (!bar || !area || !grip) return;

  const esEscritorio = () => window.matchMedia('(min-width: 821px)').matches;
  const acota = (v, a, b) => Math.max(a, Math.min(b, v));

  function limitar(x, y) {
    const maxX = Math.max(0, area.clientWidth - bar.offsetWidth);
    const maxY = Math.max(0, area.clientHeight - bar.offsetHeight);
    return { x: acota(Math.round(x), 0, maxX), y: acota(Math.round(y), 0, maxY) };
  }

  function aplicar(p) {
    bar.style.left = p.x + 'px';
    bar.style.top = p.y + 'px';
    bar.style.bottom = 'auto';
  }

  function leer() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY));
      return p && isFinite(p.x) && isFinite(p.y) ? p : null;
    } catch (e) { return null; }
  }

  /* Sin posición guardada: se apoya sobre el borde inferior del GRÁFICO (no de los
     paneles de indicadores), para que al abrir la página no tape el RSI ni el PnL. */
  function porDefecto() {
    const pa = document.getElementById('paneArea');
    const a = area.getBoundingClientRect();
    // Borde superior de la franja de paneles (la escalera va justo debajo del gráfico).
    const borde = pa ? pa.getBoundingClientRect().top - a.top : area.clientHeight;
    return limitar(12, borde - bar.offsetHeight - 8);
  }

  function restaurar() {
    if (!esEscritorio()) { bar.style.left = bar.style.top = bar.style.bottom = ''; return; }
    const p = leer();
    aplicar(p ? limitar(p.x, p.y) : porDefecto());
  }

  grip.addEventListener('pointerdown', (e) => {
    if (!esEscritorio() || e.button !== 0) return;
    e.preventDefault();
    const r = bar.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    bar.classList.add('arrastrando');
    grip.setPointerCapture(e.pointerId);

    const mueve = (ev) => aplicar(limitar(ev.clientX - a.left - dx, ev.clientY - a.top - dy));
    const suelta = () => {
      grip.removeEventListener('pointermove', mueve);
      grip.removeEventListener('pointerup', suelta);
      grip.removeEventListener('pointercancel', suelta);
      bar.classList.remove('arrastrando');
      try {
        localStorage.setItem(KEY, JSON.stringify({ x: parseInt(bar.style.left, 10), y: parseInt(bar.style.top, 10) }));
      } catch (e2) { /* almacenamiento lleno o bloqueado: la barra funciona igual */ }
    };
    grip.addEventListener('pointermove', mueve);
    grip.addEventListener('pointerup', suelta);
    grip.addEventListener('pointercancel', suelta);
  });

  window.addEventListener('resize', restaurar);
  // Los paneles cambian de alto solos (escalera, indicadores que se muestran u ocultan):
  // si el usuario no ha movido la barra, su posición por defecto sigue al borde de la franja.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { if (!leer()) restaurar(); });
    ro.observe(area);
    const pa = document.getElementById('paneArea');
    if (pa) ro.observe(pa);
  }
  restaurar();
})();
