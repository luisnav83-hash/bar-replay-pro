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
3. ~~**Libro como el suyo**~~ — **HECHO el 11-oct (segunda capa del día)**, medido en su DOM a
   1600×900 con un sonda nueva (`/tmp/medir-libro*.js`, los números van abajo) y no de memoria:
   · Carta `299×612` (la suya `305×610`); en la cabecera, las dos pestañas con subrayado blanco de
     2 px en la activa y `#919499` en la inactiva, 14 px / peso 500, sin fondo ni radio; a su
     derecha, el `0,5 ▾` de agregación (12 px), el cartel del origen del dato y «fijar».
   · **Los rótulos de las pestañas se acortan a `Libro | Mercado`** con el nombre completo en el
     `title`: los suyos miden 110 + 165 = 275 px dentro de 305 y EN SU PÁGINA el segundo sale
     recortado («Operacio», capturado), y una pestaña que no se ve no se puede pulsar.
   · **La agregación hace de verdad**: `OB.pasosDe` deriva la lista del libro que esté llegando
     (con el spot de Binance salen `0,01 · 0,1 · 1 · 10`, la familia que él enseña) y `OB.agrupa`
     fusiona niveles hacia el precio PEOR (un ask nunca baja al agrupar) ANTES de recortar por
     espacio. Anclado: con un paso grueso todos los precios pintados son múltiplos del paso.
   · **Segunda pestaña = cinta de negocios** (`/api/v3/aggTrades` por el proxy del mismo origen,
     con la misma política que el libro; ruta nueva en `server.js`). Sin red se DERIVA de la vela
     del cursor, determinista, y el cartel de arriba lo dice: una cinta inventada en 2021 sería
     mentira. Cabeceras `Hora · Precio (USDT) · Tamaño (BTC)`, 17 px por fila y el precio en el
     color del que atacó.
   · `Cant.` y `Total` alineadas a la derecha, precio central 20 px / 700 y banda del pie de 18 px
     a 12 px -los dos últimos, SOLO a partir de 861 px de alto: medido, cada 5-7 px de esas filas
     fijas se comía una fila del libro o 20-32 px del gráfico en 1000×780 y 900×700, por debajo del
     suelo de 120 que vigila `test:responsive`—.
   · `Total (USDT)` sube de 10 px / `--tx-4` (3,4:1) a 11 px / `--tx-3` (6,3:1): el mismo nivel que
     ya desterramos de los `.hint`. Y `OB.ROWS` pasa de 10 a 14 con `filasDisponibles` en 5-14:
     quedaban 62 px de hueco negro sobre las ventas con la caja de 232 px; ahora son 13 filas por
     lado, como las ~13-15 suyas. Las anclas que decían «20 filas» miden ahora el invariante
     (mitades iguales, dentro del tope) porque el número bueno depende del alto de la caja.
   · **Regla que aprendió el día**: NO se puede envolver el cuerpo del libro en un `div`. Media
     docena de reglas del tipo `#sidebar > #bookCard > .card-body > .bf-asks` hacen la aritmética
     real del cajón (`max(17px, (--cuerpo − --marco) / 2)` por lado); con el envoltorio dejaban de
     casar y el gráfico caía a 111 px. Las dos vistas se conmutan con una clase (`.modo-tape`) y
     `display:none` en lo que toca esconder.
4. ~~**Pestañas del panel inferior** con su vocabulario y sus contadores, y `Sólo actual` +
   `Cerrar todo` a la derecha~~ — **HECHO el 11-oct**, medido en su DOM a 1600×900 (es-ES, sin
   sesión) y no de memoria; la sonda se borró al cerrar el ítem así que las cifras quedan aquí.
   · SUS OCHO ETIQUETAS: `Posiciones (0) · Órdenes abiertas (0) · Historial de órdenes ·
     Historial de posiciones · Historial de operación · Historial de financiación · Activos ·
     Bots(0)`. El contador va DENTRO del texto (y en `Bots(0)` sin espacio delante del paréntesis).
     Cada etiqueta a **14 px / peso 500 igual en la activa que en la inactiva**, la activa `#fff`
     y la inactiva `#919499`, fondo transparente, radio 0, sin `uppercase` ni `letter-spacing` y
     -a diferencia del libro- **SIN subrayado**: su `::after` lleva `content: none`. Nuestras nueve
     pestañas están ancladas a eso (contadores con paréntesis incluidos).
   · SU FILA DE LA DERECHA mide 194×22 y son dos cosas: `Sólo actual` a 14 px / peso 400 con su
     casilla de ~15 px delante, y `Cerrar todo` en **píldora** (radio 9999, 12 px, `#919499`,
     64×22). No hay ningún botón `⋮` en lo medido, así que no se añade.
   · **Lo que entra y lo que no, con el porqué.** Entran las tres pestañas de historial con datos
     del motor: `Historial de posiciones` (que es lo que ya pintábamos bajo el nombre
     «Historial de trades»: una fila por posición cerrada, rebautizada), `Historial de operación`
     (una fila por EJECUCIÓN) y `Historial de financiación` (desde `TE.state.fundingLog`, que el
     motor rellena en cada liquidación real; con tasa 0 la tabla se queda vacía -no se inventan
     liquidaciones-). NO entran `Historial de órdenes` (el motor solo guarda las vivas en
     `pending`, no las ejecutadas o canceladas), `Activos` (no hay cartera) ni `Bots(0)` (no hay
     motor de bots): poner la pestaña vacía sería un adorno, y quitar adornos es de lo que va esto.
   · `Sólo actual` tiene qué filtrar de verdad: cambiar de par NO reinicia la cuenta, así que el
     historial mezcla símbolos. Para eso el motor anota el par en cada fila (`TE.state.pair` +
     `TE.setPair`, y `pair` en la posición) y la casilla filtra las tres tablas; su estado se
     guarda como `soloActual`. `Cerrar todo` es OTRA ENTRADA a `App.flatten()`, no otro camino.
   · Las CABECERAS de las dos tablas nuevas no se pueden copiar del sitio: con las tres tablas
     vacías (sin sesión) no hay ni una cabecera que medir (`filas 0`, `cabeceras []`). Las nuestras
     salen de lo que guarda el motor -`# · Dir · Hora · Precio · Cantidad · Notional · Concepto` y
     `# · Liquidación (UTC) · Dir · Tasa · Notional · Importe`- y eso queda dicho aquí, que es lo
     que este registro pide en vez de inventar un parecido.
   · DOS DEFECTOS REALES que salió encontrar al anclar esto. (1) El refresco del panel comparaba
     SOLO el número de posiciones cerradas, así que **promediar una entrada no repintaba el
     historial** (añade una ejecución sin cerrar nada): el memo pasa a comparar la forma completa
     (cerrados + filas + entradas de la abierta + liquidaciones). (2) Una ejecución se pinta una
     sola vez: las ENTRADAS viven en la posición (`parts`, la misma lista de la que cuelgan las
     marcas del gráfico) y la fila del cierre parcial aporta solo SU cierre; copiar ahí las
     entradas duplicaba cada tramo. Anclado contando filas paso a paso: 4→5→6→7→8.
   · Y una lección de cómo se mide: el ancla del subrayado usaba `getComputedStyle(e)` sin pasarle
     el pseudo, así que leía el `content` del BOTÓN (siempre `normal`) y daba por subrayadas las
     nueve pestañas. Cuadraba el número, no el hecho. Con el segundo argumento bien pasado, la
     ancla dice lo que dice la hoja de estilo.
   · Verificado con §5.4 en disco: `test:bitunix` **196 ✓ / 0 ✗** (antes 186), `run-all`
     **31 suites · 1774 ✓ · 0 ✗** (antes 1764), `test:responsive` 200 ✓,
     `tools/barrido-graficos.js` **70 · 0 NO CUADRA · 1 A DECIDIR** (la ventana 320×240, sin
     tocar por decisión del día) y `tools/build-single.js` 1129 KB.
5. **Cómo se tradea**: `Activador ▾` como desplegable que contiene Trigger/Trailing/Riesgo
   fijo (artículos 223/225), `TP/SL` como casilla que despliega el bloque, y apalancamiento
   con los dos `10X` (largo/corto) en la barra de modo — todo esto ya está en el motor
   (capas 3b/3c/3d), falta vestirlo igual.
   · 5a — **LA BARRA DE MODO: HECHA el 11-oct** (el `Activador ▾` ya estaba, ítem 6.2). Medida
     en su página recortando la cabecera de su widget (1600×900, es-ES, sin sesión): es UNA
     PÍLDORA de **272×28, radio 9999 y fondo `#222324`**, partida por una **raya de 1 px** en dos
     mitades de 135/136 px. Izquierda: `Cruzada ▾` a **12 px / peso 500** en `#ffffff`, con el
     caret en gris. Derecha: NO un número suelto, sino **los DOS apalancamientos** —`10X` en
     `#24c18d` (largo) y `10X` en `#f14b3f` (corto), cada uno de **23×16 a 12 px/500**— y detrás
     un `▾` gris que abre el editor. Sin `uppercase` ni `letter-spacing`, y con la **X
     MAYÚSCULA** (así en la barra y así en su tabla de tramos, `200X`): por eso `#bfLevVal` y
     `#tagLeverage` pasan también a `10X` -dos cajas del mismo número con dos cajas de letra
     distintas era peor el remedio—.
   · 5a · Lo que NO se copia, dicho: (1) el `▾` suyo abre un popover con la escala; el nuestro
     abre la fila del deslizador, que ya existía, es la fuente de verdad del motor y la que
     mueven las pruebas (montar un popover habría cambiado el contrato por una apariencia);
     (2) el modo de margen se queda `Cruzada | Aislada` en segmentado porque el suyo es un MENÚ
     que sin sesión no se pudo abrir -medido: solo la palabra y el caret— y copiar sus opciones
     sería inventárselas; (3) la caja de cada chip estira a lo alto de la píldora (28 px, y 24 en
     el teléfono) en vez de los 16 px suyos: el contrato táctil de esta app exige ≥20 px a todo
     control visible y ≥24 px a cada fila del formulario (`test:bitunix` lo mide), así que se
     copia la TIPOGRAFÍA y el color medidos y se respeta la diana propia.
   · 5a · Los chips no son decoración: leen `TE.leverageLadoInfo()`, en ONE-WAY los dos dicen el
     de la cuenta (por eso salen iguales, como en la suya) y en HEDGE cada uno el suyo; pinchar
     el rojo ESCRIBE en el corto reutilizando `#segLevLado`, que es el control que sabe unificar
     con «⤺ Ambos» y avisar por toast. Efecto medido en el alto: al ir el deslizador escondido
     hasta que se le llama, la tarjeta respira (~8 px más de aire a 1440×900) y la fila pasa de
     30 a 24 px en el teléfono.
   · 5a · Arreglo que salió al anclar: el alto de «Avanzado» se cachea (`btn.dataset.altoAdv`)
     porque plegado no se puede medir, y esa cifra seguía valiendo la del modo HEDGE (+54 px de
     `#segLevLado`) después de volver a ONE-WAY -nadie reevalúa el umbral para deshacer el
     pliegue—, con lo que el bloque se quedaba plegado «por espacio» con hueco de sobra. Ahora la
     caché se invalida justo cuando cambia el contenido del bloque (`UI.syncLevLados`).
     Diez comprobaciones anclan lo de arriba: caja/radio/fondo de la píldora, la raya de 1 px,
     los dos rótulos a 12/500 en blanco y gris sin caja propia, los dos `10X` con su color y su
     tipografía, la igualdad en ONE-WAY, que el deslizador escribe en los dos chips y en el
     motor, que el `▾` abre una fila con el deslizador alcanzable, que en HEDGE el rojo lee y
     escribe (corto 25×, largo 20×), que todo se puede deshacer y que NINGÚN rótulo de la píldora
     sale cortado (251 px de barra dentro de 271 de carta).
   · 5a · REMATES que salieron al verificar contra TODAS las suites, no solo la nuestra. Cada uno
     vale lo que mide, no lo que parecía:
     (1) `Cruzada` salía `Cruz…`. Los dos botones heredaban el `flex: 1 1 0` del segmentado a
     medias: cada mitad se quedaba en 55 px y la palabra pedía 58 (medido con `scrollWidth`), y el
     `text-overflow: ellipsis` heredado lo disfrazaba. Con `flex: 0 1 auto` cada botón vale lo que
     vale su texto y solo se aprieta si de verdad no cabe -así es como la píldora suya mete
     `Cruzada` + los dos `10X` + el caret dentro de 272 px—. Queda anclado que ninguna palabra
     salga con puntos, que es el defecto que este registro persigue desde la primera pasada.
     (2) En el teléfono la píldora pedía 24 px y la escalera lo cobraba caro: `test:layout` medía
     que abrir «Avanzado» LE COMÍA 4 px AL GRÁFICO (la franja pasaba de 246 a su tope de 250); con
     28 px, en cambio, `test:hedge` y `test:plantillas` veían 1 px fuera del reposo. El número
     honesto es 26 + 9 de margen = el PRESUPUESTO EXACTO de la fila vieja (su `.bf-lev` medía 26 px
     con `box-sizing: border-box`); con eso los tres contratos cuadran a 0 y la ancla dice
     «249 px abierto vs 249 cerrado». Lo que sí se aprieta aquí es la tipografía (10,5 px), como en
     el resto de segmentados del teléfono.
     (3) La `X` mayúscula se llevó a los otros dos sitios donde ese número se ve:
     `Margen (USDT) $10,000.00 (1X)` y la carta de posición `73.333,17 · 10X`. El `<select>`
     heredado (`#leverageSelect`) sigue en minúscula a propósito: no se pinta y varias suites lo usan
     como fuente de verdad del apalancamiento -tocar su texto habría cambiado un contrato por algo
     invisible—. Y `test:apalancamiento-lado` pasa a aceptar las dos cajas (`/\d[xX]/`), que es lo
     que ese ancla quería decir desde el principio.
   · Verificado con §5.5a en disco: `test:bitunix` **206 ✓ / 0 ✗** (antes 196; +10 anclas),
     `test:responsive`/`test:layout` **200 ✓**, `test:hedge` 74 ✓, `test:plantillas` 33 ✓,
     `run-all` **31 suites · 1784 ✓ · 0 ✗** (antes 1774), `tools/barrido-graficos.js`
     **70 · 0 NO CUADRA · 1 A DECIDIR** (sin cambios: la ventana 320×240 sigue sin tocarse) y
     `tools/build-single.js` **1138 KB**.
   · Nota de método, que es lo que costó el día: el ancla del plegado automático mide el REPOSO,
     y los bloques de prueba del §5 dejan el tamaño al 25 % (Coste y aviso a dos filas = +35 px,
     margen −27), así que plegarse era LO CORRECTO y no un defecto; cada bloque del §5 devuelve
     ahora el formulario a su estado de reposo (0 %, ONE-WAY, 1X, editor cerrado) con un `resize`
     por delante. Y aviso para quien toque la escalera: `autoAprieta` cachea el alto del bloque
     abierto (`btn.dataset.altoAdv`) porque plegado no se puede medir; lo que NO hay que hacer es
     adelantar ese cacheo (probado: con HEDGE fijaba 366 px y luego el bloque se plegaba con hueco
     de sobra), lo que hay que hacer es INVALIDAR la caché cuando cambia el contenido del bloque,
     que es lo que hace ahora `UI.syncLevLados`.

   · 5b — **PENDIENTE: `TP/SL` como casilla que despliega el bloque.** Ya está medido (misma
     sonda): la fila mide **272×18** a 14 px/400 con una **casilla de ~16 px** y el rótulo
     `TP/SL` a 12 px en `#ffffff`, y en el MISMO extremo derecho lleva un `Avanzado ▸` (55×14 a
     12 px). Al marcarla aparecen **dos cajas de 272×40** (fondo `#222324`, radio 4 px, paso de
     48 px) con la etiqueta `TP` / `SL` DENTRO a la izquierda y `Precio (USDT) ▾` a la derecha;
     los botones `Abrir Largo/Corto` bajan 100 px. Nota para cuando se vista: el `Avanzado ▸` suyo
     de ESA fila no es el nuestro del encabezado -el nuestro pliega el bloque entero (comisión,
     plantillas, modo de posición), no las opciones de TP/SL—, así que no se fusionan.
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

**HECHO en la pasada del 10-oct (mañana): ítems 1 y 2 de esta lista, con su medida.**

**Y el fallo que la primera versión del ítem 1 dejó puesto, descubierto al mirar la captura (no la
suite):** dejar las cifras con `flex: 1 1 0` (solo el sobrante de la línea) y confiar en que los
controles del replay *envolvieran* hacía que cupieran TODOS en la línea 1 y que `#bfStats` se
redujera a **13 px a 1440 y 117 px a 1600** contra 997 px de contenido -la captura de 1600 enseñaba
«Último 63 133,48» y ninguna cifra más, o sea: el bloque que da aspecto de Bitunix estaba cortado—.
Ninguna de las dos anclas nuevas lo veía porque miraban el solape vertical, no el ancho. Se cierra
con tres cosas: `.replay-line` forzado a `flex: 1 0 100%` (baja SIEMPRE, no «si no cabe»), un
`min-width: 240px` en la franja de cifras, y la barra en 90 px -en 76 la segunda línea asomaba
11 px y se recortaban temporalidades e iconos-. El envoltorio `.replay-line` es
`display: contents` fuera de la franja ≥1360 para no tocar el reparto del teléfono/tablet, y se
escribe dentro de un `@media (max-width:1359px)`: como regla suelta al final de la hoja pisaba por
orden de aparición al bloque 14 y la línea del replay desaparecía del reparto (medido:
`.replay-line` en `0/0/0/0`).

*Ítem 1 — la banda superior, en una franja* (`f111148`, corregido hoy). `#topbar` mide ahora
**90 px** a ≥1360 px de ancho (antes 155): en la **línea 1** van marca · par · las cifras de 24 h
· iconos (el sitio acaba su franja de símbolo en los iconos, x=1430..1560 medido a 1600), y el
mecanismo del replay (temporalidades, fecha, cargar/práctica/CSV/demo) baja a una **línea 2** de
26 px, que en el sitio no existe porque no tienen replay. No hubo que mover el DOM:
`#topbar .topbar-group { display: contents }` + `order` (par 1 · estadísticas 2 · iconos 3 ·
resto 9) y `.bf-stats { flex: 1 1 0; min-width: 0 }`; la única marca nueva en el HTML es la clase
`par-field` sobre el campo del par. Dos cosas que se rompieron y se cazaron midiendo: meter el
grupo entero en la línea 1 mandaba las estadísticas a la línea 2 desbordando la barra (stats en
y=43..89 con la barra en 76), y fijar la altura con `min-height` dejaba la caja en 95 px con las
filas del workspace fraccionarias (`34px 327.766px 201px 44px`), lo que rompía por 1 px la
contabilidad de `PC.comprimeEscalera`. **Ganancia: 79 px de gráfico** (fila 268 → 347 a
1440×900). Anclas nuevas en `test:bitunix`: `statsMismaFranja` (solape vertical entre `#bfStats`
y `#btnSymbols`) y `barraAlta` (60-80 px). En `test:pnl-chart` la comprobación «los indicadores
se aprietan en vez de ocultarse» afirmaba un ESTADO (a 1440×900 tocaba apretar) y con los 79 px
ya no toca nada; ahora se PROVOCA el apretación en una ventana de 600 px (J2b) y se deja «no
hace falta apretar ninguno» como el resultado bueno.

*Ítem 2 — la tarjeta de órdenes cabe* (sin comitear aún, 10-oct). Lo que se hizo:
· **`☐ TP/SL` a la manera de ellos, pero medido en vez de fij**o: el bloque «Avanzado» (312 px:
  modo de posición + comisión + SL/TP + plantillas) se pliega SOLO cuando los botones de entrada
  se salen del cajón (`autoAprieta` en `js/uiController.js`); si la persona toca el botón, manda
  su criterio y esto se aparta. La CSS que lo hacía posible estaba atrapada dentro de
  `@media (max-width:640px)`; ahora vive al final de la hoja (bloque 15).
· **La tarjeta de órdenes pasa la primera en la columna** (`#sidebar > #orderCard { order: -1 }`,
  ≥1001 px): medido en el sitio, `Margen` y `Activos (USDT)` van DEBAJO del formulario, no encima,
  y aquí `#bookCard` + `#panelsCard` abrían un hueco de 360 px que empujaba la entrada fuera de la
  ventana.
· El pie del formulario dice **`Coste (USDT)` y `Margen (USDT)`** con la unidad en un
  `<span class="uni">` que el teléfono oculta (en 390 px esos seis caracteres aplastaban
  `#sizeInput` de 42 a 24 px, y ese campo es área táctil medida por `test:bitunix`).

| Ventana | Antes | Después |
|---|---|---|
| 1440×900 | «Abrir Largo» a 149 px del borde, tarjeta 697 | **se ve todo abierto, pincha `elementFromPoint`** |
| 1360×900 | tapado por el panel inferior | **abierto, clip 0** |
| 1280×800 | clip 188 px, no se podía pinchar | plegado por espacio, **clip 0, pinchable** |
| 1024×768 | clip 220 px | plegado por espacio, **clip 0, pinchable** |
| 1600×1000 | — | abierto, clip 0 |

Lo que NO se replica, dicho en claro: la línea `VIP 0 · Maker 0.0200% · Taker 0.0600%` del pie
suyo es dato de cuenta (su nivel de comisión real); aquí la comisión la fija `#feeInput` y
escribir un «VIP 0» sería un adorno falso. Y la fila `Máximo (USDT)` suya es el coste total de la
posición; la nuestra debajo de los botones es `Margen` (lo que bloquea), que no es lo mismo: se
añadió la unidad, no se cambió el significado.

**Disciplina que se aprendió a golpes en esta pasada:** las suites de navegador
(`tests/bitunix.test.js`, `responsive`, `plantillas`, `hedge`) y `tools/barrido-graficos.js` abren
**`bar-replay-pro-unico.html`, el archivo único generado**. Un parche que no va seguido de
`node tools/build-single.js` se prueba contra el CSS y el JS ANTIGUOS y sale en verde: así pasó
un borrado accidental de los 1900 px de `css/bitunix.css` (un `python` que escribió `fin + nuevo`
en vez de `reemplazar`) sin que se enterase ninguna suite. Desde ahora: **parchear → construir → suites**, y `git diff --stat` antes de dar nada por bueno.

**HECHO el 11-oct (rieles y abiertos del barrido).** Cuatro cosas, todas medidas antes:
· **Riel vertical de dibujo** (lo que faltaba del ítem 3): a ≥1360 px los útiles pasan a una
  columna de 34 px a la izquierda del lienzo, con `padding-left` en la carta para que el gráfico,
  la leyenda, los paneles y la barra de replay se desplacen TODOS -como en el sitio—. La fila 1 del
  grid pasa a `--toolbar-h: 0px`, así que la contabilidad que comparten `PC.ajustaEscalera` y
  `tests/pnl-chart.test.js` sigue cuadrando (367 de fila == 367 de caja, solape 0) y el gráfico
  GANA 20 px en vez de perderlos. El primer intento puso `#drawToolbar` en `position:absolute` con
  `top:0;bottom:0`: su caja medía lo mismo que el área (612 px), la fórmula `612 − 612 − 44`
  dejaba la escalera en 0 y el gráfico caía al suelo de 240 -lo contó `pnl-chart` como
  «caja 240 == fila 568, solape 240»; la prueba existía y funcionó-. Ahora el toolbar se queda
  como ítem del grid con **altura 0** y el riel visible es su envoltorio `.rail-body`, que fuera de
  la franja es `display:contents` (a 1280 px la barra horizontal sigue ocupando «exacto su fila»,
  28 en 28, como exige `tests/responsive.test.js`).
· **Filas del libro que siguen al espacio** (era el punto 1 de esta lista): `OB.renderBook`
  pinta `suelo(alto / 17)` filas, entre 5 y 12, recortando por las LEJANAS al precio (los arrays
  vienen de mejor a peor y el `max` de las barras de profundidad se recalcula sobre lo pintado,
  si no la última barra parecería corta donde solo falta espacio). Un `ResizeObserver` en las dos
  cajas repinta, enganchado en la primera pintura y no al cargar el módulo. Desaparecen las dos
  líneas «Libro: 10 filas pintadas en una caja de 102 px»: medido, 10 filas en 235 px a 1440 y
  6 en 102 px a 1280, desborde 0 en los dos casos.
· **Space**: el `preventDefault()` de nivel documento se hacía sin mirar qué estaba enfocado, así
  que un botón de la barra de replay enfocado no recibía su click nativo. Ahora la tecla se cede
  si lo enfocado es `BUTTON/A/SUMMARY/SELECT` con `tabIndex ≥ 0`, y si no es nuestra (reproducir).
· **Contraste de los `.hint`**: de `--tx-4` `#66686b` (3,43:1 con 10,5 px) a `--tx-3` `#919499`
  (6,3:1), que es el nivel que el sitio usa para TODOS sus rótulos apagados -no se inventa un
  gris-.
· **Caja flotante de orden rápida** (era el punto 1 de la lista de abajo): `#qrCard`, 312×66 en
  `#131414` con borde `#292a2b` y radio 4, anclada a `#chartWrap` en `left:12px;top:96px` -los
  96 px son para no montar la leyenda OHLC, que mide ~60 en su esquina, y el `z-index:6` es justo
  uno por encima del `#overlayCanvas` (z 5), que es lo que la hace pinchable-. Trae el ⚡ de la
  barra (con `aria-pressed` y memoria en `ST`), pre-rellena los dos precios con la vela actual
  hasta que alguien escribe (`data-editado`) y **coloca de verdad**: escribe en el formulario
  (pulsa `#segOrderType [data-otype]` y `#segSize [data-mode]`, vuelca importe y límite con su
  `input`) y llama a `App.placeOrder(side)`, la misma puerta del ratón y de los atajos B/S -dos
  caminos de colocación son dos oportunidades de que uno se oxide en silencio—. Dejar el precio
  vacío significa A MERCADO, como allí, y el sitio también lo hace así.
· **Los rótulos de entrada ya no se caen al tocar el formulario.** `UI.refreshLabels` reescribía
  los botones con el vocabulario viejo («▲ COMPRAR / LONG») en cuanto alguien pulsaba el
  segmentado, borrando el «Abrir Largo / Abrir Corto» del ítem 2 en media sesión; lo descubrió el
  ⚡ al colocar. Ahora solo cambia el icono del modo y la palabra se queda (13 caracteres, dentro
  del tope de 18 de `test:formulario`); la ancla de `test:bitunix` pide la palabra y no la cadena
  exacta, porque el icono es información legítima.

**Ojo con el riel tras esto:** al meter el ⚡ en el clúster derecho quedaban 18 blancos y el riel
desbordaba 6 px; los útiles del riel pasan a 25 px de alto y el `gap` del clúster a 1 px (28×25
sigue por encima del mínimo de 22 que vigilan las pruebas de puntero).

· **`Activador ▾` como desplegable** (era el punto 2 de la lista de abajo): el segmentado del
  sitio son DOS botones y un desplegable con lo condicional; aquí vivían cuatro en 272 px (cabían,
  pero la forma era nuestra). `#segOrderType` sigue siendo el padre de los cuatro `data-otype` -el
  cableado es `#segOrderType .seg-btn` (js/uiController.js:294) y `UI.setOrderType` recorre ese
  selector para marcar `.active`; moverlos fuera habría roto también `test:formulario`, que los
  ancla, y el `querySelector('#segOrderType .seg-btn.active')` con el que leen media pruebas-, así
  que `<details>` solo cambia DÓNDE se ven y el rótulo del resumen dice lo que hay dentro
  (`Trailing` cuando el trailing está activo, como allí). Medido a 1440: fila `251×28` con
  `Mercado 80 · Límite 80 · Activador ▾ 89` y panel `138×59` dentro de la tarjeta; a 390 la
  fila compartida con `% equity` queda en 151 px, Δ 0 de desborde en los dos casos.
· **Tres cosas que el desplegable obligó a arreglar por el camino** (todas medidas, no supuestas):
  Chrome cierra el contenido de un `<details>` con `content-visibility: hidden`, que deja caja sin
  pintura -las opciones medían 10 px y las anclas de área táctil caían-: el panel cerrado ahora es
  `display:none` de verdad. `.seg-btn` llega con `flex: 1 1 0%` y en un contenedor en COLUMNA el
  `height` no manda: las dos opciones salían de 14 px hasta poner `flex: 0 0 26px`. Y en
  `test:formulario` los `page.click` sobre trigger/trailing tenían que abrir antes el panel
  (un click real no alcanza lo que no está pintado), que de paso es una ancla mejor que la anterior.

· **`#overlayCanvas` a 1× en pantallas 2×**: `DT.resize()` sí lee `devicePixelRatio`, pero nadie
  lo llamaba cuando lo que cambia es la relación de pixeles (el `ResizeObserver` mira la caja del
  `#chartWrap`, y moverse a otra pantalla no la toca). Añadido `DT._vigilaDpr()`: escucha el media
  query de la resolución actual y se re-engancha.

**Resultado del barrido tras esto: 70 comprobaciones · 0 NO CUADRA · 1 a decidir (la ventana de
prueba de 320×240, que no es una pantalla de trading) · 69 cuadra.** Estaba en 8 NO CUADRA al
empezar la serie (recortes del libro ×2, teclado, dpr, contraste, botones de entrada ×2).

**LO QUE SIGUE ABIERTO, con su aritmética:**

Nada de la lista del §6 queda abierta: banda, formulario, recorte del libro, riel de dibujo,
filas del libro al espacio, Space, contraste, dpr, caja de orden rápida y `Activador ▾` están
hechos y anclados. Lo que sigue son DOS criterios anotados, no defectos por arreglar:

1. **El reposo del teléfono aprieta los campos.** Medido con la app en el commit previo y con los cambios de
   esta pasada, es lo mismo (no es culpa del bloque 15): a 390×844 el cuerpo de la tarjeta está
   topeado a 221 px y sus hijos se encogen, así que `#sizeInput` mide **24 px en vez de 42**. El
   sitio mantiene 42 px a ese ancho. La ancla de `test:bitunix` tolera ≥24 y pasa; el día que se
   arregle, hay que subirla a 40.
2. **Ventanas cortas por debajo de 400 px de alto:** `A DECIDIR` en el barrido (320×240), que no
   es una pantalla de trading; se anota como criterio, no como defecto.

