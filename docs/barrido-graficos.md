# Barrido medible de la zona de gráficos

Generado por `tools/barrido-graficos.js` sobre `bar-replay-pro-unico.html` con la red cortada, 61 comprobaciones en 22s: **5 no cuadran**, 55 cuadran, 1 a decidir.

Esto no es la lista de las doce quejas: es una lista **fabricada midiendo**, para poder cruzarla con ellas. Cada línea lleva el número, el sitio y el criterio. Lo que sale en «cuadra» no se toca, que fue la instrucción recibida («arreglar los errores que están bien y no cambiarlos si no arreglan nada» se entiende al revés: lo que está bien se deja).

## 1 · Lo que no cuadra (medido y mal)

**G1 · Lienzos sin escalar a devicePixelRatio 2 (retina 1360×900 (dpr 2))**  
- medido: #overlayCanvas → 1× (debería 2×)
- dónde: `canvas del gráfico`
- por qué importa: un lienzo a 1× en una pantalla 2× se ve borroso: la línea sale con antialias doble

**G2 · Teclado sobre un botón enfocado (#btnIndicators)**  
- medido: clicks contados en el botón: tras la barra 0 · tras Enter 1 (el botón abre lo que abre; lo que se comprueba es que la tecla leproduzca un click) · con la barra además arrancó la reproducción (play=true, índice 912)
- dónde: `js/uiController.js · case ' ' / case 'Enter' y el click nativo del <button>`
- por qué importa: la barra espaciadora hace preventDefault a nivel de documento y el botón enfocado no recibe su click: un botón de la barra de replay no se puede activar con la tecla que le corresponde

**G3 · Libro: 10 filas pintadas en una caja de 102 px (bookAsks)**  
- medido: 10 filas × 17 px = 170 px en 102 px de caja (max-height 102px) · caben 6 · desborde 68 px
- dónde: `#bookAsks · js/orderBook.js · css/bitunix.css (.bf-asks)`
- por qué importa: se pintan 4 fila(s) más de las que caben: la última sale cortada a la mitad y sin scrollbar · la cantidad de filas la fija OB.ROWS (js/orderBook.js:34, «ROWS = 10 · el original muestra 10-15») y el alto de la caja sale del CSS (--cuerpo), así que las dos mitades no se han visto nunca: 10 × 17 = 170 px en 102 px

**G4 · Libro: 10 filas pintadas en una caja de 102 px (bookBids)**  
- medido: 10 filas × 17 px = 170 px en 102 px de caja (max-height 102px) · caben 6 · desborde 68 px
- dónde: `#bookBids · js/orderBook.js · css/bitunix.css (.bf-asks)`
- por qué importa: se pintan 4 fila(s) más de las que caben: la última sale cortada a la mitad y sin scrollbar · la cantidad de filas la fija OB.ROWS (js/orderBook.js:34, «ROWS = 10 · el original muestra 10-15») y el alto de la caja sale del CSS (--cuerpo), así que las dos mitades no se han visto nunca: 10 × 17 = 170 px en 102 px

**G5 · Contraste de los rótulos pequeños de la zona de gráficos**  
- medido: medidos 10 · #ohlcLegend 11.13:1/11px · #lgInd 11.13:1/11px · #bfIndex 5.61:1/9.5px · #bookBidPct 8.7:1/9.5px · #bookAskPct 5.73:1/9.5px · #tagPrice 5.17:1/9.5px · #trigHint 3.01:1/10.5px · #limitHint 3.01:1/10.5px · #riesgoHint 3.01:1/10.5px · #posPnlSparkNote 5.92:1/10px
- dónde: `css/bitunix.css`
- por qué importa: #trigHint (3.01:1 a 10.5px) · #limitHint (3.01:1 a 10.5px) · #riesgoHint (3.01:1 a 10.5px) —por debajo de 4,5:1 con letra pequeña (WCAG AA); ojo: `.hint` se mide sobre el primer elemento de la clase, no es un promedio

## 2 · Lo que hay que decidir tú (medido, pero el criterio no es mío)

**D1 · retina 1360×900 (dpr 2): por qué el lienzo de dibujos no escala**  
- medido: forzando DT.resize() pasa a 2× (el dpr es 2)
- dónde: `js/drawingTools.js:139 · #overlayCanvas`
- nota: el código sabe escalar; falta que alguien llame al cambiar la pantalla (ventana movida a otro monitor, zoom del navegador): el bug es de cableado, no de fórmula

## 3 · Lo que está bien y NO se toca

| comprobación | medido | dónde |
|---|---|---|
| Nitidez a devicePixelRatio 1 (escritorio 1360×900 (dpr 1)) | #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #overlayCanvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× | `#mainChart/#overlayCanvas/paneles` |
| Scroll horizontal de la página (escritorio 1360×900 (dpr 1)) | Δx 0 px sobre 1360 px · Δy 0 px | `documento` |
| Recortes en #chartArea (escritorio 1360×900 (dpr 1)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (escritorio 1360×900 (dpr 1)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (escritorio 1360×900 (dpr 1)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (escritorio 1360×900 (dpr 1)) | ningún desbord > 1 px | `#bottomPanel` |
| Alineación del lienzo de dibujos con el gráfico (escritorio 1360×900 (dpr 1)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (escritorio 1360×900 (dpr 1)) | #panePnl 100 px vs PC.alto() 100 (mín 56) · #chartPnl cliente 74 / contenido 74 (recorte 0 px) · #mainChart 271 · #chartArea 550 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (escritorio 1360×900 (dpr 1)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Scroll horizontal de la página (retina 1360×900 (dpr 2)) | Δx 0 px sobre 1360 px · Δy 0 px | `documento` |
| Recortes en #chartArea (retina 1360×900 (dpr 2)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (retina 1360×900 (dpr 2)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (retina 1360×900 (dpr 2)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (retina 1360×900 (dpr 2)) | ningún desbord > 1 px | `#bottomPanel` |
| Alineación del lienzo de dibujos con el gráfico (retina 1360×900 (dpr 2)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (retina 1360×900 (dpr 2)) | #panePnl 100 px vs PC.alto() 100 (mín 56) · #chartPnl cliente 74 / contenido 74 (recorte 0 px) · #mainChart 271 · #chartArea 550 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (retina 1360×900 (dpr 2)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Nitidez a devicePixelRatio 1 (portátil 1024×768 (dpr 1)) | #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #overlayCanvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× | `#mainChart/#overlayCanvas/paneles` |
| Scroll horizontal de la página (portátil 1024×768 (dpr 1)) | Δx 0 px sobre 1024 px · Δy 0 px | `documento` |
| Recortes en #chartArea (portátil 1024×768 (dpr 1)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (portátil 1024×768 (dpr 1)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (portátil 1024×768 (dpr 1)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (portátil 1024×768 (dpr 1)) | ningún desbord > 1 px | `#bottomPanel` |
| Alineación del lienzo de dibujos con el gráfico (portátil 1024×768 (dpr 1)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (portátil 1024×768 (dpr 1)) | #panePnl 64 px vs PC.alto() 64 (mín 56) · #chartPnl cliente 38 / contenido 38 (recorte 0 px) · #mainChart 240 · #chartArea 435 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (portátil 1024×768 (dpr 1)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Nitidez a devicePixelRatio 3 (teléfono 390×844 (dpr 3)) | #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #mainChart canvas 3× · #overlayCanvas 3× · #chartPnl canvas 3× · #chartPnl canvas 3× · #chartPnl canvas 3× · #chartPnl canvas 3× · #chartRsi canvas 3× · #chartRsi canvas 3× · #chartRsi canvas 3× · #chartRsi canvas 3× | `#mainChart/#overlayCanvas/paneles` |
| Scroll horizontal de la página (teléfono 390×844 (dpr 3)) | Δx 0 px sobre 390 px · Δy 0 px | `documento` |
| Recortes en #chartArea (teléfono 390×844 (dpr 3)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (teléfono 390×844 (dpr 3)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (teléfono 390×844 (dpr 3)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (teléfono 390×844 (dpr 3)) | ningún desbord > 1 px | `#bottomPanel` |
| Alineación del lienzo de dibujos con el gráfico (teléfono 390×844 (dpr 3)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (teléfono 390×844 (dpr 3)) | #panePnl 60 px vs PC.alto() 60 (mín 56) · #chartPnl cliente 34 / contenido 34 (recorte 0 px) · #mainChart 194 · #chartArea 375 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (teléfono 390×844 (dpr 3)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Nitidez a devicePixelRatio 1 (ventana mínima 320×240 (dpr 1)) | #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #mainChart canvas 1× · #overlayCanvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartPnl canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× · #chartRsi canvas 1× | `#mainChart/#overlayCanvas/paneles` |
| Scroll horizontal de la página (ventana mínima 320×240 (dpr 1)) | Δx 0 px sobre 320 px · Δy 587 px | `documento` |
| Recortes en #chartArea (ventana mínima 320×240 (dpr 1)) | peor desborde 3 px | `#chartArea` |
| Recortes en #bookCard (ventana mínima 320×240 (dpr 1)) | ningún desbord > 1 px | `#bookCard` |
| Recortes en #panelsCard (ventana mínima 320×240 (dpr 1)) | ningún desbord > 1 px | `#panelsCard` |
| Recortes en #bottomPanel (ventana mínima 320×240 (dpr 1)) | ningún desbord > 1 px | `#bottomPanel` |
| Alineación del lienzo de dibujos con el gráfico (ventana mínima 320×240 (dpr 1)) | Δx 0 · Δy 0 · Δancho 0 · Δalto 0 px | `#overlayCanvas vs #mainChart` |
| Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (ventana mínima 320×240 (dpr 1)) | #panePnl 60 px vs PC.alto() 60 (mín 56) · #chartPnl cliente 34 / contenido 34 (recorte 0 px) · #mainChart 171 · #chartArea 350 | `js/pnlChart.js · #panePnl` |
| Solape leyenda ↔ eje del gráfico (ventana mínima 320×240 (dpr 1)) | intersección 0 px | `#ohlcLegend · #bfIndex` |
| Controles de la zona de gráficos que no hacen nada | sondados 39 controles · mudos: ninguno | `#chartArea · #panelsCard · #bottomPanel · #bookCard` |
| Controles que lanzan una excepción al pulsarlos | ninguno de los 39 sondados | `click() sobre cada control` |
| Leyenda OHLC al cambiar de temporalidad | 0 temporalidades probadas · con NaN/undefined: ninguna | `js/barReplay.js · #ohlcLegend` |
| Atajos de tecla con el foco dentro de un campo | foco en #sizeInput · teclas b/s/t/f/x y espacio · órdenes nuevas 0 · play alternado false | `js/uiController.js (guarda `typing`)` |
| Leyenda OHLC al sacar el cursor del gráfico | sigue el cursor: false · al salir: «BTC/USDT 1h O 77,186.00 H 77,336.93 L 76,913.49 C 77,156.13 » · cierre de la vela actual 77156.13 | `#ohlcLegend` |
| Lienzos duplicados tras seis cambios de tamaño | 15 lienzos antes · 15 después de 6 resize | `#mainChart/#chartPnl/#overlayCanvas` |
| Vaivén de la altura de la escalera (ResizeObserver) | alturas medidas tras estabilizar: 0 · 0 · 0 · 0 · 0 px (establecida 0 → 0) | `js/pnlChart.js · #paneArea` |
| Zona de gráficos con la máquina recién reiniciada | velas 2000 · índice 875 · NaN en la leyenda false · «NaN» escrito en 0 sitios | `estado inicial` |
| Libro: las dos mitades del desbalance cuadran | bid 40.58 + ask 59.42 = 100.0 % · filas 10/10 · barras 40.6 % / 59.4 % · origen «derivado» | `js/orderBook.js · #bookCard` |
| Libro: el precio último es el del gráfico | #bookLast «78,338.03» · cierre actual 78338.03 | `#bookLast` |
| Errores de consola y excepciones durante todo el barrido | 0 de la app · 30 abortos de red del arnés (esperados aquí, con la red cortada) | `consola del navegador` |

---

_Cómo releer esto: un «NO CUADRA» con un número al lado es un defecto que se puede arreglar y verificar; las quejas sin número (me lo imagino yo o las invento) no entran en la lista. Si alguna de tus doce no aparece aquí, dímela y la mido: el barrido se amplía en un minuto, no hace falta que recuerdes las otras once._
