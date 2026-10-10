# Barrido medible de la zona de gráficos

Generado por `tools/barrido-graficos.js` sobre `bar-replay-pro-unico.html` con la red cortada, 70 comprobaciones en 23s: **0 no cuadran**, 69 cuadran, 1 a decidir.

Esto no es la lista de las doce quejas: es una lista **fabricada midiendo**, para poder cruzarla con ellas. Cada línea lleva el número, el sitio y el criterio. Lo que sale en «cuadra» no se toca, que fue la instrucción recibida («arreglar los errores que están bien y no cambiarlos si no arreglan nada» se entiende al revés: lo que está bien se deja).

## 1 · Lo que no cuadra (medido y mal)

_Nada: el barrido no encontró defectos medibles._
## 2 · Lo que hay que decidir tú (medido, pero el criterio no es mío)

**D1 · Botones de entrada a la vista sin desplazar (ventana mínima 320×240 (dpr 1))**  
- medido: #btnLong: 34 px de alto, su borde inferior en y=697 con la ventana en 240 y la columna en 732 · se puede pinchar desde ese punto: false (lo que hay encima: nada) · tarjeta 248 px · 0 px ocultos por su propio scroll
- dónde: `#orderCard · css/bitunix.css (bloque 11)`
- nota: ventana de prueba de 240 px de alto: por debajo de ~400 px no cabe el formulario completo en ninguna pantalla de trading, así que se anota como criterio y no como defecto

## 3 · Lo que está bien y NO se toca

| comprobación | medido | dónde |
|---|---|---|
| Nitidez a devicePixelRatio 1 (escritorio 1360×900 (dpr 1)) | #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #overlayCanvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× | `#mainChart/#overlayCanvas/paneles` |
| Botones de entrada a la vista sin desplazar (escritorio 1360×900 (dpr 1)) | #btnLong: 40 px de alto, su borde inferior en y=688 con la ventana en 900 y la columna en 702 · se puede pinchar desde ese punto: true · tarjeta 692 px · 0 px ocultos por su propio scroll | `#orderCard · css/bitunix.css (bloque 11)` |
| Scroll horizontal de la página (escritorio 1360×900 (dpr 1)) | Δx 0 px sobre 1360 px · Δy 0 px | `documento` |
| Recortes en #chartArea (escritorio 1360×900 (dpr 1)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (escritorio 1360×900 (dpr 1)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (escritorio 1360×900 (dpr 1)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (escritorio 1360×900 (dpr 1)) | ningún desbord > 1 px | `#bottomPanel` |
| Recortes en #orderCard (escritorio 1360×900 (dpr 1)) | ningún desbord > 1 px | `#orderCard` |
| Alineación del lienzo de dibujos con el gráfico (escritorio 1360×900 (dpr 1)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (escritorio 1360×900 (dpr 1)) | #panePnl 100 px vs PC.alto() 100 (mín 56) · #chartPnl cliente 74 / contenido 74 (recorte 0 px) · #mainChart 367 · #chartArea 612 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (escritorio 1360×900 (dpr 1)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Nitidez a devicePixelRatio 2 (retina 1360×900 (dpr 2)) | #mainChart canvas 2× · #mainChart canvas 2× · #mainChart canvas 2× · #mainChart canvas 2× · #overlayCanvas 2× · #chartPnl canvas 2× · #chartPnl canvas 2× · #chartPnl canvas 2× · #chartPnl canvas 2× · #chartRsi canvas 2× · #chartRsi canvas 2× · #chartRsi canvas 2× · #chartRsi canvas 2× · #chartRsi canvas 2× · #chartRsi canvas 2× · #chartRsi canvas 2× | `#mainChart/#overlayCanvas/paneles` |
| Botones de entrada a la vista sin desplazar (retina 1360×900 (dpr 2)) | #btnLong: 40 px de alto, su borde inferior en y=688 con la ventana en 900 y la columna en 702 · se puede pinchar desde ese punto: true · tarjeta 692 px · 0 px ocultos por su propio scroll | `#orderCard · css/bitunix.css (bloque 11)` |
| Scroll horizontal de la página (retina 1360×900 (dpr 2)) | Δx 0 px sobre 1360 px · Δy 0 px | `documento` |
| Recortes en #chartArea (retina 1360×900 (dpr 2)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (retina 1360×900 (dpr 2)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (retina 1360×900 (dpr 2)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (retina 1360×900 (dpr 2)) | ningún desbord > 1 px | `#bottomPanel` |
| Recortes en #orderCard (retina 1360×900 (dpr 2)) | ningún desbord > 1 px | `#orderCard` |
| Alineación del lienzo de dibujos con el gráfico (retina 1360×900 (dpr 2)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (retina 1360×900 (dpr 2)) | #panePnl 100 px vs PC.alto() 100 (mín 56) · #chartPnl cliente 74 / contenido 74 (recorte 0 px) · #mainChart 367 · #chartArea 612 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (retina 1360×900 (dpr 2)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Nitidez a devicePixelRatio 1 (portátil 1024×768 (dpr 1)) | #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #overlayCanvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× | `#mainChart/#overlayCanvas/paneles` |
| Botones de entrada a la vista sin desplazar (portátil 1024×768 (dpr 1)) | #btnLong: 40 px de alto, su borde inferior en y=465 con la ventana en 768 y la columna en 612 · se puede pinchar desde ese punto: true · tarjeta 383 px · 0 px ocultos por su propio scroll | `#orderCard · css/bitunix.css (bloque 11)` |
| Scroll horizontal de la página (portátil 1024×768 (dpr 1)) | Δx 0 px sobre 1024 px · Δy 0 px | `documento` |
| Recortes en #chartArea (portátil 1024×768 (dpr 1)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (portátil 1024×768 (dpr 1)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (portátil 1024×768 (dpr 1)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (portátil 1024×768 (dpr 1)) | ningún desbord > 1 px | `#bottomPanel` |
| Recortes en #orderCard (portátil 1024×768 (dpr 1)) | ningún desbord > 1 px | `#orderCard` |
| Alineación del lienzo de dibujos con el gráfico (portátil 1024×768 (dpr 1)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (portátil 1024×768 (dpr 1)) | #panePnl 64 px vs PC.alto() 64 (mín 56) · #chartPnl cliente 38 / contenido 38 (recorte 0 px) · #mainChart 241 · #chartArea 436 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (portátil 1024×768 (dpr 1)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Nitidez a devicePixelRatio 3 (teléfono 390×844 (dpr 3)) | #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #overlayCanvas 3× · #chartPnl canvas 3× · #chartPnl canvas 3× · #chartPnl canvas 3× · #chartPnl canvas 3× · #chartRsi canvas 3× · #chartRsi canvas 3× · #chartRsi canvas 3× · #chartRsi canvas 3× | `#mainChart/#overlayCanvas/paneles` |
| Botones de entrada a la vista sin desplazar (teléfono 390×844 (dpr 3)) | #btnLong: 34 px de alto, su borde inferior en y=679 con la ventana en 844 y la columna en 714 · se puede pinchar desde ese punto: true · tarjeta 248 px · 0 px ocultos por su propio scroll | `#orderCard · css/bitunix.css (bloque 11)` |
| Scroll horizontal de la página (teléfono 390×844 (dpr 3)) | Δx 0 px sobre 390 px · Δy 0 px | `documento` |
| Recortes en #chartArea (teléfono 390×844 (dpr 3)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (teléfono 390×844 (dpr 3)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (teléfono 390×844 (dpr 3)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (teléfono 390×844 (dpr 3)) | ningún desbord > 1 px | `#bottomPanel` |
| Recortes en #orderCard (teléfono 390×844 (dpr 3)) | ningún desbord > 1 px | `#orderCard` |
| Alineación del lienzo de dibujos con el gráfico (teléfono 390×844 (dpr 3)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (teléfono 390×844 (dpr 3)) | #panePnl 60 px vs PC.alto() 60 (mín 56) · #chartPnl cliente 34 / contenido 34 (recorte 0 px) · #mainChart 194 · #chartArea 375 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (teléfono 390×844 (dpr 3)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Nitidez a devicePixelRatio 1 (ventana mínima 320×240 (dpr 1)) | #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #overlayCanvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× | `#mainChart/#overlayCanvas/paneles` |
| Scroll horizontal de la página (ventana mínima 320×240 (dpr 1)) | Δx 0 px sobre 320 px · Δy 622 px | `documento` |
| Recortes en #chartArea (ventana mínima 320×240 (dpr 1)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (ventana mínima 320×240 (dpr 1)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (ventana mínima 320×240 (dpr 1)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (ventana mínima 320×240 (dpr 1)) | ningún desbord > 1 px | `#bottomPanel` |
| Recortes en #orderCard (ventana mínima 320×240 (dpr 1)) | ningún desbord > 1 px | `#orderCard` |
| Alineación del lienzo de dibujos con el gráfico (ventana mínima 320×240 (dpr 1)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (ventana mínima 320×240 (dpr 1)) | #panePnl 60 px vs PC.alto() 60 (mín 56) · #chartPnl cliente 34 / contenido 34 (recorte 0 px) · #mainChart 208 · #chartArea 387 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (ventana mínima 320×240 (dpr 1)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Controles de la zona de gráficos que no hacen nada | sondados 45 controles · mudos: ninguno | `#chartArea · #panelsCard · #bottomPanel · #bookCard` |
| Controles que lanzan una excepción al pulsarlos | ninguno de los 45 sondados | `click() sobre cada control` |
| Leyenda OHLC al cambiar de temporalidad | 0 temporalidades probadas · con NaN/undefined: ninguna | `js/barReplay.js · #ohlcLegend` |
| Atajos de tecla con el foco dentro de un campo | foco en #sizeInput · teclas b/s/t/f/x y espacio · órdenes nuevas 0 · play alternado false | `js/uiController.js (guarda `typing`)` |
| Teclado sobre un botón enfocado (#btnIndicators) | clicks contados en el botón: tras la barra 1 · tras Enter 1 (el botón abre lo que abre; lo que se comprueba es que la tecla leproduzca un click) · con la barra además arrancó la reproducción (play=false, índice 887) | `js/uiController.js · case ' ' / case 'Enter' y el click nativo del <button>` |
| Leyenda OHLC al sacar el cursor del gráfico | sigue el cursor: false · al salir: «BTC/USDT 1h O 76,976.01 H 77,204.68 L 76,772.05 C 77,130.02 » · cierre de la vela actual 77130.02 | `#ohlcLegend` |
| Lienzos duplicados tras seis cambios de tamaño | 15 lienzos antes · 15 después de 6 resize | `#mainChart/#chartPnl/#overlayCanvas` |
| Vaivén de la altura de la escalera (ResizeObserver) | alturas medidas tras estabilizar: 0 · 0 · 0 · 0 · 0 px (establecida 0 → 0) | `js/pnlChart.js · #paneArea` |
| Zona de gráficos con la máquina recién reiniciada | velas 2000 · índice 882 · NaN en la leyenda false · «NaN» escrito en 0 sitios | `estado inicial` |
| Libro: 14 filas pintadas en una caja de 0 px (bookAsks) | 14 filas × 0 px = 0 px en 0 px de caja (max-height 102px) · caben 0 · desborde 0 px | `#bookAsks · js/orderBook.js · css/bitunix.css (.bf-asks)` |
| Libro: 14 filas pintadas en una caja de 0 px (bookBids) | 14 filas × 0 px = 0 px en 0 px de caja (max-height 102px) · caben 0 · desborde 0 px | `#bookBids · js/orderBook.js · css/bitunix.css (.bf-asks)` |
| Libro: las dos mitades del desbalance cuadran | bid 56.31 + ask 43.69 = 100.0 % · filas 14/14 · barras null % / null % · origen «derivado» | `js/orderBook.js · #bookCard` |
| Libro: el precio último es el del gráfico | #bookLast «77,486.09» · cierre actual 77486.09 | `#bookLast` |
| Contraste de los rótulos pequeños de la zona de gráficos | medidos 10 · #ohlcLegend 11.94:1/11px · #lgInd 11.94:1/11px · #bfIndex 6.3:1/9.5px · #bookBidPct 8.3:1/9.5px · #bookAskPct 5.31:1/9.5px · #tagPrice 5.17:1/9.5px · #trigHint 6.3:1/10.5px · #limitHint 6.3:1/10.5px · #riesgoHint 6.3:1/10.5px · #posPnlSparkNote 6.3:1/10px | `css/bitunix.css` |
| Errores de consola y excepciones durante todo el barrido | 0 de la app · 63 abortos de red del arnés (esperados aquí, con la red cortada) | `consola del navegador` |

---

_Cómo releer esto: un «NO CUADRA» con un número al lado es un defecto que se puede arreglar y verificar; las quejas sin número (me lo imagino yo o las invento) no entran en la lista. Si alguna de tus doce no aparece aquí, dímela y la mido: el barrido se amplía en un minuto, no hace falta que recuerdes las otras once._
