# Brecha visual y de flujo con Bitunix (medida, no recordada)

**Fecha de la medición:** 2026-10-10. **Método:** `tools/captura-bitunix.js` abre
`https://www.bitunix.com/contract-trade/BTCUSDT` en Chromium headless (viewport 1600×900,
`Accept-Language: es-ES`), se quitan los banners de cookies, y mide el **DOM real** del
sitio: cajas, `getComputedStyle` de los botones, variables CSS declaradas en `:root`,
etiquetas visibles con su coordenada y el árbol del panel de órdenes. En la misma corrida
abre **la nuestra** (`bar-replay-pro-unico.html`) y mide lo mismo, para que la comparación
sea con la misma regla. Salida: `docs/bitunix/medida.json` + 6 PNG.

Hasta ahora la piel se había anclado **contra percentiles de color de una captura** y
contra lo que yo recordaba de los artículos de ayuda. Eso es lo que hay que corregir: el
`test:bitunix` §B afirmaba como «medido del original» valores que no lo estaban
(`cuerpo ≤ 12,5 px`, `radioCard = 0px`, subrayado lima, «Abrir Long/Short»). Aquí está el
valor del sitio vivo y se reancla el test a él.

---

## 1 · Tokens medidos en el sitio (ellos) frente a los nuestros

| Cosa | Bitunix (DOM real) | Nosotros (mismo arnés) |
|---|---|---|
| Tipografía base | `"noto sans"`, **14 px** (`--bu-fsz:14px`, `--bu-h5-fsz:12px`, `--bu-pc-fsz:16px`) | `Inter`, **12 px** |
| Rótulos secundarios | 12 px `#919499`, **sin mayúsculas, sin letter-spacing** | 9,5–11 px `#5f626b` `uppercase` + `letter-spacing .5-1.1px` |
| Peso | 400 / 500 / 600 | 500 / **700** |
| Fondo de página | **#000000** | `#08080a` |
| Tarjeta del gráfico | **#121212**, radio **4 px** | `#0d0d10`, radio **0 px** |
| Panel inferior | **#0f0f0f**, radio 4 px | `#141418` |
| Caja de campo / barra de modo | **#222324** (hover `#2c2c2e`) | `#1c1c22` |
| Borde | **#292a2b**, 1 px | `#242429` |
| Texto | `#ffffff` valor · `#919499` etiqueta · `#66686b` atenuado | `#f2f3f5` · `#c2c4ca` · `#8b8e96` · `#5f626b` |
| Verde | **#24c18d** (botones) · #00c383 (Comprar del widget del gráfico) | `#25ca93` |
| Rojo | **#f14b3f** (botones) · #f65353 (Vender del widget) | `#f65b55` |
| Lima | **#b9f641 sólo en marketing** («Registrarse», «Ultra»), texto `#131f00`, radio 20 px | `#b8f040` usado como **acento de todo lo activo** (tabs, segmentados, play) |
| Tab de timeframe activo | fondo **#272829**, texto blanco, radio 4 px | lima |
| Pestaña activa | texto blanco + subrayado, **sin lima** | subrayado lima 2 px |
| Botón de entrada | **2 pills de 131×40, radio 9999px**, texto blanco 14 px w500: «Abrir Largo» / «Abrir Corto» | `Abrir Long` / `Abrir Short`, radio 4 px, texto 13 px w700, tinte oscuro sobre verde |
| Ancho de la columna de órdenes | **272 px** (x=1311 en 1600) | **336 px** |
| Emoji en rótulos | **ninguno** | «⚡Mercado», «⏳Límite», «🎯Trigger», «📈Riesgo» |

## 2 · El panel de órdenes, fila por fila (medido en el sitio, x=1311 w=272)

```
y=114  pestañas de la columna:  Futuros | Grid                      (14 px, activa blanca)
y=181  barra 272×30 fondo #222324: «Cruzada ▾» | «10X 10X ▾»      (10X largo en #24c18d, corto en #f14b3f)
y=221  segmentado 272×30: [Abierto #24c18d texto blanco] Cerrado  ← modo de posición (HEDGE/ONE-WAY)
y=267  pestañas de tipo, SIN fondo: Mercado(blanco) · Límite · Activador ▾ · ⓘ   (14 px, h=28)
y=312  «Disponible» 12 px #919499 ..... «0.0000 USDT» 12 px blanco (fw600)
y=341  etiqueta «Precio» (12 px #919499)
y=361  caja 272×42 #222324 radio 4: ● punto verde 12×12 + «82993.2» 14 px + sufijo «USDT» #66686b
y=415  etiqueta «Cantidad»
y=435  caja 272×42 #222324: input 173×22 placeholder «Orden mínima 0.9» | sufijo «USDT ▾» (51×32, clic)
y=489  arco-slider 260×12 con 5 puntos y marcas 0% 25% 50% 75% 100% (12 px #919499) debajo
y=535  ☐ «TP/SL» (12 px blanco, h=18)
y=569  [ Abrir Largo ] 131×40 #24c18d · [ Abrir Corto ] 131×40 #f14b3f   (radio 9999, 14 px w500 blanco)
y=621  «Coste (USDT) 0.0»   |   «Coste (USDT) 0.0»       (etiqueta #919499 12 px, valor blanco 12 px)
y=643  «Máximo (USDT) 0.0»  |   «Máximo (USDT) 0.0»
y=689  «VIP 0» · «Maker 0.0200%» · «Taker 0.0600%»       (12 px; «VIP» en #919499, resto blanco)
y=753  tarjeta siguiente: «Margen / USDT・Cruzada / Tasa de margen 0.00% / Margen de mantenimiento 0.0»
y=930  tarjeta siguiente: «Activos (USDT) / Equidad de divisas …»
```

Libro (x≈1004–1300): pestañas «Libro de órdenes | Operaciones de mercado» (activa blanca,
inactiva `#919499`, h=38); arriba a la derecha la agregación `0.1 ▾`; cabeceras
`Precio (USDT) · Cant. (USDT) · Total (USDT)` 12 px `#919499`; en medio el precio grande
`82,993.2` en `#24c18d` con su flecha y a la derecha un duplicado en gris con icono; y
**abajo la barra partida** `B 49.40%` (verde) / `S 50.60%` (rojo), 18 px de alto, 12 px.

Banda superior (y=0–100): nav de 40 px (logo, menú, buscador `#19191a` radio 14, «Iniciar
sesión» transparente blanco, «Registrarse» lima `#b9f641` texto `#131f00` radio 20);
luego franja de símbolo: `BTCUSDT` 18 px blanco + `Bitcoin` 12 px gris + **precio grande en
verde**, y **ocho celdas de estadística** (etiqueta 12 px gris arriba, valor 14 px blanco
debajo): Cambio en 24h · Precio Marcado · Precio índice · Máximo 24h · Mínimo 24h ·
Cantidad en 24h(BTC) · Volumen de 24H(USDT) · Tasa de financiación/(8h) con cuenta atrás
`00:17:44`. Después, a la derecha, iconos (sin texto).

Gráfico: tarjeta `#121212` radio 4 en `x=0 y=113 w=984 h=610`; dentro, fila de
temporalidades `1m 5m 15m 30m 1h ▾` (activo con fondo `#272829`, radio 4, 12 px), icono de
tipo de vela, indicadores, alarma, compartir, ajustes, «Último precio ▾» y a la derecha la
píldora lima «Ultra». **Las herramientas de dibujo van en un riel vertical a la izquierda**
(~34 px de ancho, iconos, sin texto), no en una barra horizontal encima del gráfico. Sobre
el gráfico flota un **widget de orden rápida** de 312×66 en (50,180), fondo `#131414`,
borde 1 px `#292a2b`, radio 4: `[Comprar 82,993.1] [Por costo (USDT) ▾ / input] [Vender 82,993.2]`
con una × para cerrarlo.

Panel inferior: `#0f0f0f` radio 4, pestañas de 38 px: `Posiciones (0) · Órdenes abiertas (0) ·
Historial de órdenes · Historial de posiciones · Historial de operación · Historial de
financiación · Activos · Bots(0)`; a la derecha `☐ Sólo actual · Cerrar todo` y un `⋮`.

## 3 · Diagnosis: por qué «no se parece en nada»

1. **Escala tipográfica.** Todo lo nuestro está a 12/9,5 px y ellos a 14/12 px. Un 15 % de
   letra y un 20 % de interlineo de diferencia cambian la densidad percibida de toda la
   pantalla.
2. **Mayúsculas y letter-spacing.** Nuestro look «terminal» viene de `uppercase` + `.5-1.1px`
   en todos los rótulos; Bitunix no usa nunca esa receta — sus rótulos son frase en gris.
3. **El lima mal usado.** reservado a marketing; en nosotros pinta lo activo (tabs,
   segmentados, play), que en ellos es **gris `#272829`** o **verde `#24c18d`**.
4. **Radios.** Ellos 4 px en todo y **píldora (9999)** en los dos botones de entrada; nosotros
   0 px en tarjetas y 4 px en los botones.
5. **Fondos.** Ellos negros puros con tarjetas `#121212`/`#0f0f0f` y campos `#222324`;
   nosotros grises azulados (`#08080a`/`#141418`) que además se ven «morados» por los
   `--bg-*` heredados del tema anterior.
6. **El panel de órdenes no tiene sus filas.** Faltan: la barra `Cruzada | 10X 10X`, el
   segmentado `Abierto | Cerrado`, las pestañas de tipo (somos chips con emoji), el punto
   verde dentro del campo de precio, el sufijo `USDT ▾` en cantidad, las marcas 0-25-50-75-100
   bajo el slider, la fila `Coste/Coste · Máximo/Máximo` **debajo** de los botones y el pie
   `VIP · Maker · Taker`. Sobran: nuestros rótulos con emoji y el chip `% equity` como
   segmentado principal.
7. **Ancho de la columna**: 336 px frente a 272 px — el nuestro respira un 24 % más y eso
   solo ya descoloca la proporción de la pantalla.
8. **Los dibujos van en otro sitio**: riel vertical a la izquierda vs nuestra barra
   horizontal encima del gráfico; y no existe el widget flotante de orden rápida (que en
   ellos es *la* forma de operar desde el gráfico, artículo 225 y F9 del estudio).
9. **El estado «replay» se nos ha ido a la cabecera** (banner de producto + «INICIO REPLAY»
   + reloj grande) mientras en ellos la cabecera es el símbolo y sus estadísticas de 24 h.
   El usuario mira arriba y ve otra aplicación.

## 4 · Lo que se hace en esta pasada (capa visual)

* Tokens re-anclados a la tabla §1, tipografía a 14/12 px sin mayúsculas ni spacing, radios
  4/9999, lima devuelto a marketing, `--right-w: 272px`.
* Tema del gráfico (`js/chart.js`) a `#121212` / texto `#919499` / rejilla `#1f2020` y velas
  `#24c18d`/`#f14b3f`.
* Rótulos de los botones: **Abrir Largo / Abrir Corto** — así los llama el sitio en español;
  el `Abrir Long / Abrir Short` nuestro no aparecía en ningún panel de la página real.
* Fila `Coste (USDT) · Máximo (USDT)` bajo los botones y pie `VIP · Maker · Taker`.
* El `test:bitunix` §B **re-anclado** a los números de esta medición (era un ancla de
  captura; ahora es DOM del sitio vivo) y con la fuente de cada valor en el mensaje.

## 5 · Lo que queda para las pasadas siguientes (apunte para no perderlo)

1. **Banda superior como la suya**: nav (logo + menú + buscador + «Registrarse» lima) y franja
   de símbolo con las 8 estadísticas; mover el mecanismo de replay dentro de la tarjeta del
   gráfico (fila de temporalidades + una franja fina abajo) en vez de banner propio.
2. **Riel vertical de dibujo** a la izquierda del gráfico (34 px, iconos, radio 4) y **widget
   flotante de orden rápida** (312×66, `#131414`, borde `#292a2b`) encima de la esquina
   superior izquierda, con `Comprar precio / Por costo (USDT) ▾ / Vender precio` y ×.
3. **Libro como el suyo**: pestañas `Libro de órdenes | Operaciones de mercado`, agregación
   `0.1 ▾` arriba a la derecha, barra de profundidad **detrás** de Cant./Total alineada a la
   derecha, precio del medio en grande con flecha, y la barra `B xx% / S xx%` de 18 px al
   final. Esto arregla de paso el recorte de 68 px que midió `tools/barrido-graficos.js`
   (10 filas de 17 px en una caja de 102 px): su libro cabe porque la caja es alta, no
   porque pinten menos filas.
4. **Pestañas del panel inferior** con su vocabulario y sus contadores, y `Sólo actual` +
   `Cerrar todo` a la derecha.
5. **Cómo se tradea**: `Activador ▾` como desplegable que contiene Trigger/Trailing/Riesgo
   fijo (artículos 223/225), `TP/SL` como casilla que despliega el bloque, y apalancamiento
   con los dos `10X` (largo/corto) en la barra de modo — todo esto ya está en el motor
   (capas 3b/3c/3d), falta vestirlo igual.
6. Seguir con `tools/barrido-graficos.js` como verificador: los contrastes `.hint` a 3,01:1
   y el `#overlayCanvas` a 1× en pantallas 2× siguen abiertos.

---

## 6 · Lo que quedó ATERRIZADO en esta pasada (y lo que no)

**Aplicado y medido después de aplicar:**

| Cambio | Antes | Después |
|---|---|---|
| Cuerpo / rótulos | 12 px · `uppercase` + `letter-spacing` | **14 px** · minúsculas · `tabular-nums` |
| Pila tipográfica | `Inter` y `--mono` (ui-monospace) en cifras | `"noto sans"` delante de todo; `--mono` apunta a la misma sans |
| Fondo página / tarjeta / panel | `#08080a` / `#0d0d10` / `#141418`, radio 0 | **#000000 / #121212 / #0f0f0f**, radio **4 px** |
| Campos | 30 px | **42 px** en precio y cantidad de la orden (34 px el resto) |
| Verde y rojo | `#25ca93` / `#f65b55` | **#24c18d / #f14b3f** |
| Lima | acento de TODO lo activo | solo `--accent` (marketing); lo activo = `--activo` verde y `--seg-fondo` `#272829` |
| Botones de entrada | `Abrir Long/Short`, radio 4, w700 | **`Abrir Largo / Abrir Corto`, píldora 9999, w500, blanco** |
| Columna derecha | 336 px con libro y órdenes apilados | **272 px** de órdenes + **libro en columna propia de 300 px** (≥1360 px de ancho; por debajo `UI.ubicarLibro()` la devuelve a `#sidebar`) |
| Tema del gráfico | `#0a0a0b` / ejes 9 px mono | `#121212` · ejes **12 px sans** · `#919499` |
| `test:bitunix` §B | anclado a percentiles de un PNG | **re-anclado al DOM del sitio** (157 ✓) |

**Comprobado con las suites:** `test:bitunix` 157 ✓ · `test:pnl-chart` 151 ✓ · `test:responsive` 200 ✓ · `test:hedge` 74 ✓ · `test:formulario` 33 ✓ (batería completa en curso).

**Efectos secundarios cazados por las pruebas** (los apunto porque son la parte incómoda):
1. Al pasar la columna a 272 px con cuerpo de 14 px, la tarjeta de órdenes creció y **el libro
   desapareció en tablet/teléfono** —lo había metido en `#bookCol`, que está `display:none` por
   debajo del corte—. Lo vio `test:responsive` (18 comprobaciones a cero) y lo arregla
   `UI.ubicarLibro()`.
2. Los `.grid-2` de la tarjeta seguían repartiendo **188+188 px dentro de 251 útiles**: TAKE
   PROFIT se salía 125 px de la tarjeta (es el desbordamiento de 19 px que arrastrábamos,
   agravado al estrechar). Ahora los pares van **a una columna**, que además es como lo hacen
   ellos (cada campo, la fila entera).
3. La barra superior, con los campos a 42 px, se comía 34 px del gráfico y la escalera
   desbordaba sus propios paneles a 1280×800. Arreglado con un tier de **ventana baja**
   (≤820 px de alto): barra más apretada y suelo del lienzo a 208 px; a 900 px de alto no se
   toca nada.

**LO QUE SIGUE ABIERTO, con su aritmética** (por orden de lo que se nota):

1. **La barra de arriba, en dos filas como la suya.** La nuestra sigue en tres (marca · par/
   temporalidad/fecha · estadísticas) y ocupa 155 px a 1440×900; la de ellos son **113 px**
   (nav 40 + franja de símbolo 73 con las ocho cifras en la misma línea) —medido: par en x=52,
   estadísticas de x=392 a x=1430, todas a y=64/82—. Al fusionarlas se ganan ~42 px de alto
   para el gráfico y deja de notarse que «esto es otra aplicación». Intentado en esta pasada;
   retirado porque alteraba la contabilidad de `PC.comprimeEscalera` (las pruebas de determinismo
   viven a 1440×900 y aparecían diferencias de 1 px). Hay que hacerlo moviendo el DOM, no a
   golpes de `flex-wrap`.
2. **La tarjeta de órdenes no cabe en la fila** (695 px de tarjeta contra 495 px de fila a
   1360×900): `#btnLong` queda **tapatado por el panel inferior** —la guarda nueva del barrido
   («Botones de entrada a la vista sin desplazar») lo comprueba con `elementFromPoint`, no con
   el rect, porque la primera versión de la guarda daba FALSO POSITIVO: el rect caía dentro de la
   ventana pero debajo del panel—. Déficit: **200 px**. Se cierran con (1) [−42], el panel
   inferior por defecto más fino [−38] y **TP/SL detrás de la casilla `☐ TP/SL`, que es lo que
   hacen ellos** [−70]; sobran 50 px que se llevan las filas `Coste/Máximo` y el pie
   `VIP · Maker · Taker`, que aún no existen.
3. **Filas del libro que siguen al espacio.** A ≥1360 el libro tiene columna propia y las 10
   filas de `OB.ROWS` caben ENTERAS (desaparecieron las dos líneas «Libro: 10 filas pintadas en
   una caja de 102 px» del informe del barrido). Por debajo del corte vuelve el aplastamiento de antes:
   hace falta que `js/orderBook.js` pinte `suelo(alto/17)` filas en vez de 10 fijas.
4. **Riel vertical de dibujo + widget flotante de orden rápida** (sus 34 px a la izquierda del
   gráfico y la caja de 312×66 en `#131414` con borde `#292a2b`, `Comprar precio / Por costo
   (USDT) ▾ / Vender precio`). Nuestra barra de dibujo sigue horizontal encima del gráfico.
5. **`Activador ▾` como desplegable** (Trigger · Trailing · Riesgo fijo dentro, como los
   artículos 223/225) en vez de cuatro pestañas; con 272 px y cuatro pestañas el rótulo ya no se
   recorta (11,5 px) pero la forma de la fila sigue siendo nuestra.
6. Abiertos del barrido de esta mañana: `#overlayCanvas` a 1× en pantallas 2× (falta avisar a
   `DT.resize()` al cambiar de dpr), Space no activa el botón enfocado (Enter sí) y los rótulos
   `.hint` a 3,43:1 con 10,5 px.
