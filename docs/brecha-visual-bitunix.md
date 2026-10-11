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

   · 5b — **`TP/SL` COMO CASILLA QUE DESPLIEGA EL BLOQUE: HECHA el 11-oct.** Medido en su
     página pinchando la propia casilla (sonda Chromium 1600×900, es-ES, sin sesión), que es lo
     que faltó el día del 5a: la fila es de **272×18** y la «caja» **no es un cuadrado de 16 con
     borde**: es un **svg de 12×12** (`span.check-icon-group`), y `TP/SL` es un `span` de 34×12 a
     **12 px / peso 400 en `#ffffff`** separado del icono **4 px**; todo en un `flex` de
     `justify-content: space-between` con un `Avanzado` de 55×14 + caret de 12 en el extremo
     derecho (medido en la primera pasada; en la segunda, con la fila ya marcada, ese `Avanzado`
     mide **0×2 sin texto**: solo aparece en el estado que nosotros no reproducimos, así que NO lo
     copiamos y en su sitio va el resumen de lo escrito, que sí es dato). Al marcar salen **DOS
     CAJAS de 272×40 con paso de 48** (hueco 8), fondo `#222324`, radio 4 px y `padding: 0 12px`;
     **el rótulo `TP` / `SL` es el `placeholder` del input** (el prefijo mide 0 px: no hay etiqueta
     fuera ni dentro, así distinguen ellas) a 14 px/400 en blanco, y **`Precio (USDT)`** vive en el
     sufijo de 100×38 a **14 px/400 en `#919499`** con su caret de 12. La fila queda a 12 px de las
     cajas y a 16 px de los botones, que **bajan 100 px** (569 → 669, medido). Y el orden es
     **TP arriba, SL abajo** -el nuestro estaba al revés—, copiado.
   · 5b · Dos decisiones que valen más que el parecido. **(1) El reposo es DESMARCADO, como en el
     sitio** (su `☐ TP/SL` llega sin marcar y por eso su panel no pasa nunca de 347 px): con la
     casilla marcada por defecto el bloque mide 315 px en una columna de 556 y `autoAprieta` -que
     vigila que los botones no queden bajo el borde— **plegaría «Avanzado» solo a 1440×900**,
     tapando la comisión, el modo de posición y las plantillas por una apariencia. Costó tres suites
     enteras descubrirlo y quedó escrito en el cableado. **(2) Desmarcar APAGA y no BORRA**: los
     niveles dejan de viajar a la orden (que es lo que «apagar» significa allí) pero lo tecleado se
     queda en los campos, con un resumen en la fila -`SL 70.000 · TP 80.000`— para que lo apagado no
     se confunda con lo vacío; la casilla se recuerda en `ST` (`tpslOn`). El punto único de lectura es
     `App.tpSlLee()`, que usan los **tres** caminos de colocación (`placeOrder`, `placeTriggerOrder`,
     `placeLimitOrder`) y el aviso de abajo: no hay un «silenciar datos» por detrás, hay un estado.
   · 5b · Lo que NO se copia, dicho: el `Precio (USDT) ▾` suyo es un **selector de unidad**
     (precio / % / margen) que sin sesión no se pudo abrir, así que aquí la unidad se pinta como
     texto -que es exactamente lo que dice— y sin caret: nuestros campos son niveles de precio y
     no existe segunda unidad que elegir. La fila de atajos de % (`#quickSlTp`) es nuestra, no
     suya; se metió DENTRO del grupo porque lo que hace es escribir en esas dos cajas, y con la
     casilla apagada no tendrían destino.
   · 5b · Y la diana **táctil**. Su fila mide 18 px, que es menos de los 20 px que
     esta app exige a todo control visible; se copia la tipografía, el icono de 12 y los 4 px, pero
     el área pulsable (la etiqueta entera, con el `input` real estirado encima e invisible) sube a
     **22 px**, el mismo criterio con el que los `10X` de la barra de modo estiran a lo alto de la
     píldora. Doce comprobaciones anclan el bloque: fila e icono medidos, diana ≥20 px, reposo
     desmarcado sin parpadeo (`hidden` ya en el marcado, no puesto por JS), las dos cajas con su
     alto/paso/fondo/radio/padding y TP arriba, los placeholders, la unidad dentro de la caja en su
     gris, que el lector devuelva lo escrito, que la orden colocada LLEVE los niveles, que al
     apagarlos la orden NO los lleve y los campos los sigan guardando, y que el resumen los nombre.
   · 5b · El precio de copiar el estado (y no solo la pinta): con la casilla naciendo apagada,
     **Riesgo fijo se quedaba sin stop** -`test:riesgo-fijo` lo cazó: posición colocada con `sl:
     null`—, porque ese modo calcula el tamaño SOBRE la distancia al stop y luego adjunta el stop,
     así que apagar TP/SL allí no es estética: es una orden dimensionada sobre una condición que no
     existe. Queda resuelto en el producto, no en la prueba: entrar en Riesgo fijo **enciende la
     casilla** (`App.enciendeTpSl`, dicho en el propio `#riesgoHint` y en el log), y apagarla a mano
     en ese modo **para la orden** con el motivo (`App.riesgoGuardia`, que los cuatro caminos de
     colocación ya acataban). Tres anclas nuevas lo vigilan, incluida una que lee el aviso en el
     conjunto de toasts vivos y no en el primero -cortar la cadena por tamaño dejaba fuera el del
     guard, y el ancla mentiría al fallar—.
   · Verificado con §5.5b en disco: `test:bitunix` **220 ✓ / 0 ✗** (antes 206: +10 del bloque y +3
     del acoplamiento con Riesgo fijo), `test:riesgo-fijo` 59 ✓, `test:layout` 200 ✓,
     `test:plantillas` 33 ✓ (marcar la casilla hace crecer el bloque y el plegado automático lo
     cierra -correcto—, así que el test abre a mano como haría quien lo usa), `test:hedge` 74 ✓,
     `test:trailing-orden` 77 ✓. Y un barrido que salió FALSO dos veces y vale como método: para
     contar los rótulos en mayúsculas se barrió `#app *` -la carta de órdenes cuelga de
     `main#workspace`, no de `#app`— y luego desde `body` con «Avanzado» CERRADO por el clic de
     rigor; las 16 etiquetas del panel seguían en `uppercase` + `.7px` contra el §1. Arreglado en
     la piel (BLOQUE 23) y anclado sobre los 26 rótulos de campo. `build-single` **1149 KB**.
     Queda del §5 la banda superior, el `replay` dentro de la carta y -añadido hoy— **la versión
     móvil entera**, que también se hará midiendo la suya.
6. Seguir con `tools/barrido-graficos.js` como verificador: los contrastes `.hint` a 3,01:1
   y el `#overlayCanvas` a 1× en pantallas 2× siguen abiertos.


### 5.6 · móvil: la medición (hecha) y lo que vamos a copiar

La medición es del 11-oct, con la herramienta nueva del repo, `tools/medir-movil-bitunix.js`:
Chromium con `isMobile` y `hasTouch`, **390×844 a dpr 3**, UA de iPhone, `es-ES`, sin sesión, sobre
`https://www.bitunix.com/es-es/contract-trade/BTCUSDT`. Vuelca `/tmp/movil-bitunix.json` y cuatro PNG
`docs/movil-*.png`.

**Dos avisos de método.** El primero: **pulsar un botón de operar sin sesión redirige a `/login`**.
Las dos primeras veces que se barrió el móvil, los pasos «tras pulsar Abrir Largo» y «desplazado»
salieron llenos de su formulario de acceso (correo, `Verificar`, Google/Apple), y si uno se fía de
eso copia una página que no es la de trade. Lo que hay bajo el pliegue se lee **del DOM**, sin
desplazar. El segundo: la altura del documento salió **844 px** en una pasada y **1468 px** en otra
seis segundos más tarde; gana la segunda -la primera fue a media hidratación—. Lo que importa para
implementar no es esa cifra sino la otra: **el formulario entero cabe por encima del pliegue** (su
último botón acaba en `y=719` de 844).

Lo medido en la **vista de operar**, que es la que trae de entrada:

| qué | su número (medido en 390 px CSS) |
|---|---|
| **dos columnas: formulario `x=15..195` y libro `x=210..383`** | ~180 px útiles cada una, sin carta visible |
| `BTCUSDT` | 89×23, 18/700, en `x=15 y=142` |
| a la derecha: `Tasa de financiación/cuenta actual` | 12/400 `#919499`, valor `-0.0002` en `#f14b3f`, `02:58:06` en blanco, en `x=231 y=146` |
| píldora `Cruzada` | 48×16, 12/500 blanco, con `10X` verde y `10X` rojo pegados (`x=117`, `x=146`): metidos en la columna, no estirados |
| `Abierto` \| `Cerrado` | 88×26; la pestaña activa **rellena** `#24c18d` con el texto blanco 12/500 — en el móvil el segmento se pinta, no se subraya |
| `Mercado` | 137×16, 14/400, dentro de su caja con borde |
| `Disponible` + valor + `USDT` | rótulo 12/500 `#919499` **con subrayado de puntos**; valor 12/600 blanco |
| `Precio` / su caja | rótulo 180×16 12/400 `#919499` sobre la caja; dentro: **punto verde**, `83011.7` 14/500 `#66686b`, unidad `USDT` 12/400 |
| `Cantidad` / su caja | igual, y la unidad es un selector `USDT ▾`; el placeholder avisa del mínimo (`Orden mínim`) |
| deslizador | 180 px con **cuatro puntos** |
| `☐ TP/SL` | rótulo 34×16 12/400 blanco en `y=591` |
| **`Abrir Largo` y `Abrir Corto`** | **apilados**, 180×40, `y=624` y `y=679` (paso 55 px), radio 9999, `#24c18d` y `#f14b3f`, 14/500 blanco |
| `Coste (USDT)` y `Máximo (USDT)` | rejilla 2×2, rótulo 12/400 `#919499`, valor 12/600 blanco, en `y=734..776` |
| libro: cabeceras | `Precio (USDT)` / `Cant. (USDT)` 81×14, 12/400 `#919499`, en `x=218` |
| libro: precio de cada nivel | 12/400 en `#f14b3f` (asks) y `#24c18d` (bids), 23 px de paso, cantidad blanca sobre la barra |
| libro: último precio | `83,011.7` **17/700** `#24c18d` en el centro del libro (`y=486`), repetido abajo a 12/400 con puntos y un icono `[M]` de 18×18 |
| libro: barra de ratio | `B 51.34%` 12/500 verde · `48.66% S` 12/500 rojo, en `y≈750` |
| **bajo el pliegue** | la tira `Posiciones (0)` 92×39 · `Órdenes abiertas (0)` 135×39 · … seis pestañas que **desbordan y se deslizan en horizontal**, 14/400 (activa blanca, inactiva `#919499`), y la fila `Sólo actual` \| `Cerrar todo` 384×58 con `Cerrar todo` 80×22 `#222324` radio 9999 12/400 — lo del §5.4, sin cambios |
| el botón que cambia de vista | un grupo `pill-tabs` en la cabecera: caja `x=285..373 y=137..169`, dos ítems de **44×32** con radio 999 sobre `#1a1b1c` |

En la **vista de carta** (a la que lleva ese `pill-tabs`), medida ya con el paso `carta` de la misma
herramienta: la franja de cabecera es un bloque de **390×64 con fondo `#0f0f0f`** -un gris por encima
del negro del resto-, `BTCUSDT` a **18/700** blanco y el funding `0.00%` a 14/400; debajo, el último
precio a **24/700** en `#24c18d` (el color sigue el signo de la vela, no es un adorno), `≈ $83,016.60`
y `0,57%` a 12/400, y `Precio Marcado` con su valor a 12/400. A la derecha, cuatro estadísticas en dos
columnas: rótulo 12/400 `#919499`, valor 12/400 blanco, **paso de 18 px** entre filas. Las pestañas
`Cuadro | Resumen | Datos` son **12/500** (en escritorio 14/500: la misma piel, un punto más pequeña,
activa blanca, inactiva `#919499`, y SÍ subrayada). Y la fila de temporalidades: chips de **30×22 a
12/400 `#919499` con radio 4**, la activa en **caja `#272829`** con el texto blanco -en el móvil se
pinta, no se subraya, al revés que en el panel inferior (§5.4)-. El `canvas` mide **390×618**. Flota
sobre la carta la pareja `Abrir Corto` (rojo) | `Abrir Largo` (verde) -en el móvil el rojo va
primero-; esa pareja no llegó a los filtros de la sonda (va fija al pie del viewport, fuera del límite
de 900 px que usa el barrido), así que de ella copiamos la idea y el orden, no el número.

**Lo que se copia**:

1. **las dos columnas** formulario · libro en la franja estrecha, con el formulario de ~180 px útiles
   y sus alturas: fila de 40 px, rótulo de 12/400 encima de la caja, unidad dentro de la caja;
2. **la fila de temporalidades como en su móvil**: chips de 30×22, 12/400, radio 4 y la activa en caja
   `#272829` -el mismo control nuestro, con la piel de 390 px puesta;
3. **el `pill-tabs` de la cabecera** (44×32, radio 999) y con él el gesto **carta ⇄ operar**: en 844
   px de alto es la única forma decente de tener las dos cosas;
4. **la pareja de botones apilada a 180×40 con paso 55** en la vista de operar, y flotante sobre la
   carta en la vista de carta;
5. el **último precio a 17/700 en el centro del libro** y la barra de ratio, que en escritorio ya
   están copiados (§5.3) y en móvil faltaban.

**Lo que NO se copia y por qué**: el banner `Bitunix App … Descargar` y su `Registrarse` lima
(camuflaje de cuenta); la **navegación inferior flotante** `Página prin… | Mercados | Negociar |
Activos` (ítems 71×60 con botón redondo de búsqueda) -no tenemos esas secciones, y una nav vacía al
pie de un teléfono es la peor decoración posible-; el medidor de financiación dibujado (no lo
calculamos); el segmento `Abierto | Cerrado` de 88×26 con la
casilla activa verde rellena: es un filtro de su lista de órdenes y **aquí ese control no existe**, así
que ponerlo sería decorar con datos ajenos (lo que sí copiamos de ese detalle es *pintar* en vez de
*subrayar* la casilla activa de los chips de temporalidad); y el orden de los botones flotantes de la carta, que en nuestro caso respeta el de
`#orderActions` de escritorio porque allí manda el teclado físico.

**Contrato con `tests/responsive.test.js`**: ese fichero fija 200 anclas del teléfono (la franja del
gráfico, cero desbordes, `|Δfila| ≤ 2`, el reposo que entra entero). Al pasar el formulario al lado del
libro cambian las alturas de esa franja, así que sus números se **re-miden contra el sitio**, no contra
lo que salió la primera vez, y en el propio test queda dicho qué ancla es de piel -cambiable con
medición- y cuál es de uso y no se toca (diana táctil ≥20 px, cero desbordes, ninguna fila bajo 24 px).
Sigue anotado y sin tocar lo que el usuario dejó pendiente: `sizeInput:24` en teléfono y la ventana
320×240 del barrido.

**Hecho en esta pasada** (BLOQUE 24 de `css/bitunix.css`, `UI.vistasMoviles` en `js/uiController.js` y
`#bfVistas` en `index.html`):

· **El conmutador.** Dos cascos de 44 con radio 9999 sobre `#1a1b1c`, el activo `#272829` en blanco;
  el estado vive en `body[data-vista]` y se recuerda en `ST.vistaMovil`. **No es hijo de `#topbar`**:
  el cabecero del teléfono es una rejilla de dos columnas y tres filas de alto fijo (medido:
  `28px 32px 24px` / `186px 188px`), y meter un quinto hijo sentaba la pastilla ENCIMA de la fila del
  par -`#bfVistas` y `.topbar-group` salían los dos en `x=8 y=30` de 374×32, y `elementFromPoint`
  devolvía la pastilla en el centro del botón del símbolo: el botón del par y el chip activo dejaban
  de ser alcanzables, que fue exactamente lo que cantó `test:layout`—. Vive dentro de la fila del par,
  después de `#tfQuick`, y de regalo queda a la vista sin deslizar la fila.
· **La altura es 26, no los 32 medidos**, y la cuenta está hecha, no adivinada: con 32 el cabecero
  pasaba de 90 a 94 y `#chartWrap` de 194 a 190 -cuatro px de velas, la misma contabilidad del
  §5.5a-. La forma (88 de ancho, 44 por casco, los dos colores, el radio) sí es la medida.
· **La vista Operar**: columnas **170 · 175** con `#chartArea` fuera de pantalla, rótulos de 12/400
  `#919499` ENCIMA de cada caja, botones apilados de 161×40 con paso de 55 y radio 9999, y
  `Coste`/`Máximo` en rejilla de dos. Tres cosas que no salían a la primera:
  ‑ `.card` arrastraba `min/max-width: calc(100% - 24px)` de la época de la fila deslizante (era para
    que asomara la tarjeta vecina), y en una rejilla eso son 24 px perdidos de golpe: 146 útiles en
    vez de 170.
  ‑ quitar solo el `max-height` del cuerpo no bastaba: `--cuerpo: 216px` y el `flex: 1 1 0` dejaban la
    caja en 418 px con 445 de contenido (27 recortados). Hay que poner `height: auto`.
  ‑ en 170 px el segmentado no da para `Mercado | Límite | Activador` sin cortar (49 de contenido en
    42): ahora **desliza** en vez de truncar, igual que los chips del cabecero -un control que se
    alcanza deslizando no esconde datos; un `text-overflow: ellipsis` sí—.
· **Y es reversible sin tocar el reposo**: al volver a Carta el terminal es el que miden las 200 anclas
  de `tests/responsive.test.js` (franja de 249 que desliza, gráfico de 194, cero scroll horizontal) y
  la pastilla no añade ni un píxel de alto.
· **Medido en nuestro build a 390×844**: `#sidebar` 390×624 en `y=90`, formulario 170×432 en `x=15`,
  libro 175×275 en `x=200`, botones 161×40 con paso 55, recortes verticales 0, desbordes horizontales
  0 en las cuatro cajas, documento 844 = ventana, y los 21 controles visibles todos ≥ 20 px.
· **Dos defectos que solo se ven mirando la pantalla** (y los caz6 una ancla nueva, no una
  captura): las cabeceras de las dos tarjetas traen el alto FIJO del tier de 640 (28 y 24 px), asi que
  al envolver a dos filas pintaban su segunda linea POR ENCIMA del cuerpo -medido: `#bookSrc` en
  `y=129` con la cabecera cerrando en `125`, y el `78,508.00` del libro quedaba tachado-; y el caret
  `▾` del agregador, que esta en `position: absolute` sin caja de referencia, se quedaba solo 280 px
  mas abajo (`I` en `y=418..427` dentro de `label.bf-agreg`). Arreglados en el BLOQUE 24
  (`height: auto` en las cabeceras de la vista de operar, `position: relative` en `.bf-agreg`) y
  anclados como «ninguna cabecera pinta por encima de su caja»; el caret estaba descolocado TAMBIEN
  antes de este cambio, a 390 px en la vista de Carta: la ancla no es decorado del movil.
· **La banda de ratio del libro** sacaba `B74.64 %S25.36 %` pegados: la fila de etiquetas vive dentro
  de una `.bf-book-frac` que el tier de 640 pone en `display:flex` y se ajustaba a su propio texto, con
  lo que el `space-between` no tenia donde repartir. Ancho de fila y listo -en la suya el verde queda
  a la izquierda y el rojo a la derecha-.

· **Verificacion**: `node tools/run-all.js` en limpio da **31 suites · 1818 comprobaciones contadas ·
  0 fallidas** y `tools/barrido-graficos.js` **70 · 0 NO CUADRA · 1 a decidir** (la de siempre).
  Leccion apuntada, porque me hizo perder una ronda: en la corrida anterior `test:bitunix` saco 4
  anclas rojas (la liquidacion a `null` y la pagina servida por HTTP) estando YO corriendo una sonda
  Chromium en paralelo -solas pasaban, y en la siguiente corrida limpia tambien—; mientras la bateria
  corre, no se monte nada al lado, y si una suite falla en bateria y pasa sola, re-correrla **sola**
  antes de tocar nada.
· **Anclado** en el bloque H2 de `tests/bitunix.test.js`: 17 comprobaciones (la pastilla y sus colores,
  el arranque en Carta, el cambio de vista, las dos columnas sin pisarse, el reparto 170/175, el paso
  55, el rótulo encima de la caja, cero recortes, cero scrolls, dianas ≥ 20, el libro a dos columnas,
  la memoria en `ST` y el regreso a Carta). **`bitunix` 235 ✓ · 0 ✗.**

**Queda del móvil**, anotado para no perderlo: la **banda superior** (último precio a 24/700, fondo
`#0f0f0f`, las cuatro estadísticas a dos columnas con paso de 18 px) -que es el mismo capítulo abierto
que en escritorio, y reestructurar `#topbar` en estrecho pisa el presupuesto vertical de `test:layout`-;
la **pareja flotante sobre la carta** en la vista de carta; y las dos cosas que dejó el usuario
(`sizeInput:24` y la ventana 320×240 del barrido).

---

### 5.7 · las órdenes visuales dibujadas sobre la carta (vídeo oficial medido)

El enlace que pasó el usuario (`…/bitunix-assets/chart-trading/focused-trading/visual-orders.mp4`)
es el único sitio donde se ve esta UI: **sin sesión no hay posición que dibujar**, así que la sonda
de Chromium del §5.1 no puede medirla. Se midió **sobre el fotograma nativo** con recorte por color
(`imageio-ffmpeg` + PIL; no hay `ffmpeg` en el PATH): el vídeo es 4800×2700 a 24 fps, un plano
continuo de 32 s -`scdet` no encontró ningún corte, y el diff de fotogramas no aísla la interacción
porque la carta está viva-. 4800/3 = 1600 y 2700/3 = 900: es justo el viewport de nuestras sondas de
escritorio, así que **la calibración es ÷3** y se cruzó con un elemento ya medido en el DOM (el riel
de dibujo: 34 px). Con eso, lo que sale del fotograma es geometría y estructura; **los hex NO salen
del vídeo**, que está comprimido y saca el verde `#01bb79` donde el DOM real da `#24c18d` -los colores
de la implementación son los tokens del §1-.

| medido en el vídeo (px CSS) | qué es | qué hacemos |
| --- | --- | --- |
| grupo 30 de alto, 268 de ancho | la etiqueta que cabalga la línea | alto fijo **30**, ancho el que pida el contenido |
| pastilla 27×119 sólida | `SL 0,1592` / `TP 0,1592` en blanco sobre el color del lado | `label + cantidad` en 12/400, relleno `#f14b3f`/`#24c18d`, radio 4 |
| caja `#1a1b1c` al lado | el PnL firmado que daría ese nivel (`-30,8` / `+42,45`) en el color del lado | sale de `TE.pnlBrutoEn`, que es la fórmula de `closePosition` -no una copia en el lienzo- |
| celda separada por un hilo `#292a2b` | la `×` que quita el nivel | caja de 26×30 al final del grupo; clic → `TE.setSL(null)`/`setTP(null)` + el campo del formulario se vacía + aviso |
| nace en x=182, no en el borde derecho | la etiqueta sigue a **la vela de la orden** | `DT._xOf(entrada)` con recorte contra el borde por el ancho real del grupo |
| línea de SL/TP discontinua, la de entrada punteada | y sin rótulo de la librería sobre la línea | `lineStyle` 2 y 1; **quitado** el `title` de SL/TP (`axisLabelVisible` sigue) |
| banda verde/roja mientras arrastras (t=4-7 y 25-28) | zona de ganancia hacia arriba en el TP, de pérdida hacia abajo en el SL | relleno al 8,5 % del color del lado solo mientras `DT.drag` apunta a ese handle |

Lo que **no** se copia todavía, que el vídeo también enseña (apuntado para no perderlo):

1. **El billete al arrastrar sobre la carta vacía**: panel flotante con `Posición 63942,1/63827,1`,
   campo de cantidad, `Market Buy` y ✓, con el riel `0 % 25 % 50 % 75 % 100 %` debajo (t=17-20).
   **HECHO en §5.8**, con sus números sacados del DOM (no del mock) y su aritmética delegada en el
   formulario.
2. **El `⊕` del extremo de la línea y su menú** (t=2-3 y 13-16) — **HECHO en §5.9** en lo que aquí
   tiene acción de motor detrás (recolocar y cancelar); `add alert` y `To price` quedan sin copiar por
   ausencia de función, y la pastilla `[Trigger | precio | ×]` sigue abierta. Las órdenes límite
   pendientes: su pestaña ámbar del borde derecho fue RETIRADA en §5.10 y sustituida por el cartel de tres
   compartimentos que sale en el fotograma, que es además el agarre del arrastre.
3. **El riel con imán / lápiz+candado / candado / ojo** y la **hora actual en negrita** en el eje de
   tiempo, más la insignia circular de TradingView: son de la carta, no de la orden.

**Contrato**: 12 anclas nuevas en `tests/bitunix.test.js` (sección I), que sube la suite a 250 ✓ 0 ✗.
Como esto se pinta en `#overlayCanvas`, las anclas **muestrean el píxel del lienzo** (que la pastilla
del TP sea exactamente `#24c18d`, que la del SL sea `#f14b3f`, que el tinte no se salga de la caja de
30 px, que la banda aparezca con alfa > 0 al arrastrar y desaparezca al soltar) y no leen CSS; se
comprueban además los golpes (`×` clickeable y fuera del arrastre, el resto de la pastilla sí agarra)
y la aritmética (`20 / 20 / null`). El montaje del test invierte las coordenadas (`CM.yToPrice`) para
elegir precios que caigan dentro del lienzo: a ±3 % de la entrada el TP se salía por arriba y el
muestreo daba negro -error de medición nuestro, no de la piel-.

### 5.8 · el billete de orden visual (arrastrar en la carta para colocar)

Segunda pieza del mismo vídeo. Antes de tocar nada **se intentó medir en el sitio real** con una sonda
nueva (`tools/medir-concentrado-bitunix.js`, salida en `/tmp/concentrado.json`) y de ahí salen tres
datos que cambian el método de esta sección:

1. **La carta de Bitunix es un `iframe`** (`Financial Chart`, 984×530 en la ventana de 1600×900): el
   `getComputedStyle` de la página padre no ve lo que hay dentro, así que el billete y el menú de la
   línea **no son medibles en el DOM sin sesión** aunque se entre en `Pantalla completa` (el botón está
   en la cabecera, título medido, y al pulsar la carta sube de `y=215` a `y=167`). Para esa capa, el
   vídeo oficial es la única fuente de **estructura**; las **cifras** se van a buscar a los controles
   análogos del panel de órdenes, que sí es DOM propio.
2. **La pila tipográfica de los controles ya no es Noto Sans**: el `body` sigue en `"noto sans" 14 px`,
   pero inputs y botones del panel resuelven `Geist, "PingFang SC", OSPunctuation, …` y
   `document.fonts` trae Geist 400/500/600/700. Adoptado solo en lo nuevo (`--font-panel`), con
   `"noto sans"` de fallback: cambiar la pila en el formulario entero mueve métricas de texto y las 200
   anclas de `test:layout` miden justo eso -queda como criterio aparte, no colado de rebote.
3. **El riel de % real es un slider de Arco de 272×25** (caja en `x=1311 y=490`) con sus cinco marcas
   `0 % 25 % 50 % 75 % 100 %` en `12/400 #919499` a **16 px** del borde superior de la caja (rótulos en
   `y=506`). La pista en sí no se midió (los selectores `.arco-slider-line`/`-thumb` no casan con su
   marca de clase), así que se deja la pista del navegador con `accent-color`: mejor eso que un grosor
   adivinado.

Enseñanza de herramienta, apuntada porque costó: **`page.evaluate('(x) => …')` pasando la función en
CADENA no falla en esta versión de Puppeteer -devuelve `{}` en silencio**, porque la cadena se evalúa
como expresión y el objeto función no serializa**. Toda sonda escrita en cadena hay que lanzarla con
`run(page, FUENTE)` (`eval('(' + src + ')')` dentro de la página); si no, el informe sale en blanco y
parece que el sitio no tiene la UI cuando lo que no tiene es la prueba.

**Lo que se implementa.** Herramienta nueva en el riel (`data-tool="orden"`, atajo visible en su
`title`): al pulsar sobre la carta **no se dibuja, se coloca** - se abre el billete en el punto con el
precio del cursor ya ajustado al paso del símbolo, y la carta pinta su línea discontinua en el color del
lado con un punto en el ancla. El billete (`.bf-billete`, dentro de `#chartWrap`):

| pieza | de dónde sale | qué es |
| --- | --- | --- |
| panel 298 px, `#131414`, pelo `#292a2b`, radio 4 | §1 (widget flotante medido) | 298 = 272 del campo + 12+12 de padding + 1+1 de pelo |
| un campo por fila de **272×40**, `#222324`, radio 4, `padding 0 12px` | §2 y §5.5b (los campos reales del panel) | `Precio (USDT)` y el del tamaño; con los dos en la misma fila el rótulo se truncaba |
| rótulo encima, 12/400 `#919499`, línea de 14 | las etiquetas reales `Precio (USDT)` 86×14, `Cantidad (USDT)` 83×14, `Total (USDT)` 104×14 | el del tamaño se presta de `UI.SIZE_LABELS`, así que dice lo mismo que el formulario |
| ✓ **40×40** en `#24c18d` (rojo `#f14b3f` con Vender) | altura de botón medida en el sitio; color del lado del §1 | confirmar |
| riel `272×25` con cinco marcas a 16 px | el Arco medido hoy | `input[type=range]` con `step=25` |
| dos segmentados: `Límite \| Mercado` y `Comprar \| Vender` | nuestra piel de `.seg` | `data-btipo`/`data-blado` a propósito: **los cuatro `data-otype` siguen siendo los únicos dueños de `#segOrderType`** (hay un ancla que lo vigila) |

**Y sobre todo: el billete no tiene aritmética ni validación propia.** Escribe en `#sizeInput` y
`#limitInput`, el riel de % **dispara el botón `#quickSize [data-pct]`** que ya hace la cuenta contra el
saldo, y para colocar **pulsa el botón de lado del panel** (`#btnLong`/`#btnShort`), así que el modo de
riesgo, los TP/SL marcados, las comisiones y el registro son el mismo camino de siempre. Si el
formulario la rechaza, el billete se queda abierto con su motivo encima (se compara el estado antes y
después, no el `click`). `Escape` lo cierra y borra su línea.

Dos bugs de montaje que solo se ven midiendo, y quedaron anclados: recolocar la ventana con la altura
medida **después del reflujo** (`offsetHeight` nada más quitar el `hidden` daba 269 por 279 reales y el
billete se salía 2 px del área de carta) y el `max-height: calc(100% - 16px)` con desplazamiento
interno, para que en la franja móvil o con los paneles de indicadores abiertos nunca desborde.

**Lo que NO se copia aquí**: el **menú del `⊕`** en el extremo de la línea -que es justo lo que se hizo
en §5.9, con sus dos acciones de motor y lo que no se puede copiar razonablemente-. Sigue abierto del riel
ajeno: imán, lápiz+candado, candado y ojo, y la hora actual en negrita en el eje de tiempo. (El cartel
`[Trigger | 64 175,1 | ×]` sobre la línea quedó HECHO en §5.10, con su `×` y su palabra del formulario.)

### 5.9 · el `⊕` del extremo de la línea y su menú (el billete en modo edición)

**Qué enseña el vídeo.** Del `visual-orders.mp4` se sacó el cuadro de t=14,5 s (`ffmpeg -ss 14.5 -vf
crop=1700:1400:3000:500`, 1060 px) y se **leyó**, que es la única manera de saber qué filas traía. En el
extremo de cada línea de orden, pegado al eje de precio, hay un **disco gris con un `+` sentado sobre la
línea**; al picarlo sale un panel con: `🕐 At 64,175.1 · add alert`, separador, `⚡ At 64,175.1 · Set order`
con la orden en rojo (`Sell limit order`), el segmentado `Limit | Fixed Risk`, `By Cost (USDT) ▾`, el
botón rojo `Sell`, la fila de chispas `10 % 20 % 50 % 100 %`, `+ At 64,175.1 · Trigger order (Market)` con
sus pastillas Buy/Sell, y abajo `Cancel order` y `To price`.

**Qué se copia.** El disco y las dos filas que aquí tienen una acción de motor detrás: **recolocar**
(precio y, para una pendiente, tamaño) y **cancelar**. `✓` en modo edición no coloca una orden nueva
encima de la vieja: retira la pendiente (`App.cancelOrder`) y la vuelve a colocar por el formulario, así
que la cuenta de pendientes **no cambia** — que es precisamente el criterio con el que el billete sabe
que puede cerrarse (si el recuento baja a `antes - 1`, es que la nueva fue rechazada y el billete se
queda abierto con su aviso). Para un nivel, `✓` escribe en `TE.setSL`/`TE.setTP` y no toca ni la entrada
ni el otro nivel (anclado).

**Qué NO se copia, dicho con la comprobación hecha:**

- `add alert`: no hay sistema de alertas. `grep -n "alerta" js/*.js index.html` solo devuelve avisos
  (`U.toast`), y no hay ningún mecanismo que disparar — una fila de alertas decorosa sería un botón que
  miente.
- `To price`: no hay «ir al precio» que sea distinto del reposo, porque la carta se autoajusta en cada
  barra; y `scrollToPosition` no existe en este código.
- `Limit | Fixed Risk` y `Trigger order (Market)`: `Fixed Risk` es el modo de riesgo del margen, que
  aquí vive en `#segMarginMode`; copiar el segmentado dentro del billete crearía un segundo sitio donde
  se puede contradecir al primero. En su lugar **la fila de tipo se apaga** en modo edición: una pendiente
  es límite por definición y ofrecer `Mercado` ahí sería prometer una orden que no puede quedar colgada.
- La pastilla `[Trigger | 64 175,1 | ×]` sobre la línea: **hecha en §5.10** (con su `×` que cancela la
  orden y su palabra tomada del formulario); lo que no se copia es editar el número **dentro** del lienzo.

**Las medidas, y de dónde salen.** El disco mide **24×24**: no hay forma de sacarle una geometría al mock
(su panel de fotograma mide ~428 px CSS, que no es CSS), así que el tamaño es el de los iconos de
cabecera de la carta **medidos en su DOM** (`Velas`, `Indicadores técnicos`, `Crear alerta`: 24×24 en
y=161), y su posición `x = ancho del lienzo - 24 - 2` es el borde derecho real del `#overlayCanvas`.
Relleno `#222324` (la entrada medida), aro `#4a4d55` y `+` en `#919499` son tokens nuestros. Las chispas
miden **28 px de alto** (la altura de fila medida en el sitio, `nav-link` 58×28), 12/400 en `--font-panel`
sobre `#222324` con radio 4 y sin pelo; `Cancelar orden` son 28 px en `#f14b3f` (el rojo medido) a 14/500
con un pelo superior `--line`, alineado a la izquierda, sin caja ni fondo: es una fila de menú, no un
botón.

**Las chispas no son una lista nuestra.** Se **clonan de `#quickSize [data-pct]`** en el arranque y su
clic *dispara el botón del formulario*, así que la cuenta contra el saldo sigue viviendo en un solo sitio
(anclado: 50 % por la chispa = 50 % por el botón, 5046,83 USDT los dos). Lo único escrito a mano es el
` %` del rótulo, porque el `textContent` de sus botones es el número desnudo y nuestro riel ya rotula
`50 %`. Y al abrir el menú la chispa viene **encendida** con lo que ya lleva el formulario, no cinco
botones apagados.

**La carta cambia de forma según qué línea la abrió**, que es lo que hace el suyo y no un adorno:
pendiente → precio + importe + chispas + riel, fila roja `Cancelar orden`; SL/TP → **fuera** el importe,
las chispas y el riel (el tamaño del nivel la posición ya lo lleva; dejarlos ahí mudos es peor que
quitarlos) y la fila roja pasa a decir `Quitar SL` / `Quitar TP`, que borra el nivel en el motor y en el
formulario (anclado: `sl === null` y `#slInput` vacío, y su disco desaparece del lienzo).

**Cuatro defectos que solo salen midiendo, y quedaron anclados:**

1. `.bf-billete-chips { display: flex }` **ganaba al `[hidden]`** del navegador: la fila, oculta, seguía
   ocupando sus 28 px + 12 de margen, y el billete de colocar pasaba de los 279 px anclados en §5.8 a
   319. Añadido `.bf-billete-chips[hidden] { display: none }` (la fila roja ya tenía su guarda, de ahí la
   asimetría) y una ancla que exige expresamente que el panel de colocación **no haya crecido**.
2. El `+` se pinta en el lienzo, y el lienzo está con `pointer-events: none` salvo que el hover reconozca
   lo que hay debajo. Como `_onWrapMove` no conocía el disco, **el `mousedown` no llegaba a `_onDown`**:
   el billete se abría al llamar a `DT.onTradePlus` a mano y no con el ratón. Misma trampa que ya
   documenté con las pestañas de SL/TP en §5.7; el disco entró en esa condición.
3. Anclar el panel al **punto del clic** (`x - ancho`) dejaba su borde derecho 2 px encima del propio `+`,
   con lo que la única forma de volver a cerrar el menú era cerrarlo desde su `×`. Ahora `abre()` acepta
   `xDerecha` y el panel **termina** 8 px antes del disco; de paso la línea editada queda a la vista.
4. El billete **recuerda su tipo a propósito** (el suyo también), pero ese recuerdo se quedaba entre
   aperturas: después de pulsar `Mercado` una vez, el `✓` colocaba a mercado y la prueba de colocación
   dejaba una posición en vez de una pendiente. Ahora `abre()` re-aplica y repinta el tipo, y el reposo de
   las pruebas del §5 lo devuelve a `Límite`.

**Contrato**: 17 anclas nuevas en `tests/bitunix.test.js` (bloque K), que sube `test:bitunix` a
**283 ✓ · 0 ✗**. Los vecinos, sin moverse: `responsive` 200, `dibujos` 18, `gesto` 12,
`limite-arrastrar` 26, `dom.smoke` 51, `formulario` 33, `limites` 14, `single` en verde y
`browser.capture` 47 con 0 errores de JavaScript. Evidencia: `docs/evidencia-5-9-menu-linea.png`
(billete abierto desde el `⊕` de una pendiente, con su chispa de 50 % encendida y `Cancelar orden`
debajo). La sonda funcional con la que se verificó el flujo antes de anclarlo quedó en
`tools/sonda-5-9.js`.

### 5.10 · la pastilla `Límite | precio | ×` sobre la línea de la orden

**Qué enseña el fotograma.** Leído a resolución nativa (el `.mp4` da 4800×2700; el recorte de t=17 en
`/tmp/nativo17.png`), sobre la línea de orden hay un **cartel de tres compartimentos** -`Trigger |
64,175.1 | ×`- con dos pelos de 1 px entre ellos, sentado **encima de la línea**, y en el extremo derecho
el disco `⊕` que ya tenía su sitio pegado al eje. Es decir: la línea se etiqueta, se edita y se cancela
desde su propio cartel, sin ir al panel.

**Qué se copia.** El cartel, con sus tres compartimentos y su `×`. En nosotros dice
`Límite | 68,007.40 | ×`, y la palabra **no la inventa el pintor**: es la que el propio formulario tiene
para el tipo de esa orden (`#segOrderType [data-otype="limite"]` → `DT._palabraTipo(h.tipo)`; para un
`Activador` saldría `Activador`). copiar literalmente `Trigger` sería mentir: una pendiente nuestra es
límite. La `×` **cancela la orden** (`App.cancelOrder`), no «quita un nivel»: una pendiente puede colgar
sin ninguna posición abierta, y ese era el caso que el `onTradeClear` de §5.7 devolvía por `!pos`.

**Qué se retira.** La pestaña ámbar con `⇕` que había en este sitio era invento de §5.7: hacía lo mismo
(agarrar y mover) con menos información y 14 px de alto en vez de los 30 de una etiqueta. Al quitarla
salió un bug viejo suyo: `CM.priceToY(null)` **no** devuelve `null`, devuelve un número, así que un
`Activador` o un `Trailing` pendiente -cuya línea la carta no pinta porque `CM.setPendingLines` solo lee
`o.limitPrice`- recibía su pestaña clavada arriba del todo. Ahora `DT.setPendingHandles` filtra las
órdenes sin precio de línea: donde no hay línea no hay etiqueta (y no se le escribe `limitPrice` al
arrastrar, porque el panel lee ese campo como el precio de la orden).

**El color del número, dicho con su medición**: en el fotograma el texto del cartel muestreado sale
`#838287` (gris), así que de ahí no se puede afirmar que fuera verde; se queda el blanco de §5.7 para el
número y el color de la línea (`COLORS.limit` = `#ffab00`, el `--warn` de siempre) para la palabra. Caja
`#1a1b1c`, pelos `#292a2b`, `×` en `#919499` - los mismos tokens medidos en el DOM que sujetan las
etiquetas de SL/TP, verificados aquí muestreando el propio lienzo (el relleno de la pastilla sale
`#1a1b1c` exacto).

**Interacciones, y las tres que estaban rotas de antes:**

- **Clic sin arrastre** (≤2 px de viaje) sobre el cartel abre el **mismo billete en modo edición** que el
  `⊕`, anclado a la izquierda de la pastilla para no taparla (`_onUp` → `DT._clicPastilla`, que
  además **no comite** el `end`: si el gesto no movió, no hay precio nuevo que soltar).
- **La `×` cancela con el ratón**. Esto arreglaba un hueco de §5.7: su ancla preguntaba al predicado
  (`DT._hitTradeX`) y el predicado estaba bien, pero el `mousedown` real nunca llegaba porque
  `_onWrapMove` no encendía `pointer-events` para las `×` -el lienzo las cubría con `none`, y como
  `_hitTradeHandle` devuelve `null` a propósito en la `×`, nada las habilitaba. Ahora el hover conoce la
  `×` y el `+`, y el bloque L lo prueba clicando de verdad en los dos casos.
- **Arrastrar el cartel mueve la orden** (`App.moveLimitOrder`, una sola pendiente antes y después) y el
  número del cartel pinta el precio **en vivo** mientras dura el gesto.
- **La pastilla no puede tapar el `⊕`**: su margen derecho es el borde izquierdo del disco
  (`24 + 2 + 6`), no el borde del lienzo; con el margen viejo la `×` quedaba literalmente debajo del disco
  -que se comprueba antes- y el clic abría el billete en lugar de cancelar.

**Las dos lecciones de captura de esta pasada**, porque ambas eran falsos positivos míos y una de ellas
casi me hace «arreglar» algo que no estaba roto:

1. El lienzo de las velas se repinta en `requestAnimationFrame`; si el `screenshot` se dispara sin esperar,
   la carta sale **negra** (0,31 % de píxeles no negros en la zona de velas) aunque el `overlayCanvas` -que
   se pinta sincrónico- salga perfecto. Esperar dos frames deja la misma captura en 9,43 % ✓.
2. Comparar la posición pintada con una medición posterior engaña: la autoescala de la carta **anima**
   cuando entra una vela nueva, y la pastilla de la captura estaba en la fila que la escala tenía en su
   momento. Cerrado con la ancla que compara las dos cosas en el mismo instante
   (`DT._yOf(h.price)` contra `CM.series.candles.priceToCoordinate(h.price)`, tolerancia 2 px) y con la
   verificación por píxeles de §5.7: la fila roja pintada en 61 ↔ `DT._yOf(sl)=61`, la verde en 31 ↔
   `DT._yOf(tp)=31`.

**Contrato**: 9 anclas nuevas en `tests/bitunix.test.js` (bloque L) ⇒ `test:bitunix` **292 ✓ · 0 ✗**.
Vecinos, todos verdes: `limite-arrastrar` 26 (el arrastre sigue funcionando sin la pestaña), `dibujos` 18,
`gesto` 12, `responsive` 200, `dom.smoke` 51, `formulario` 33, `limites` 14, `hedge` 74, `single`, y
`browser.capture` 47 con 0 errores de JavaScript. Evidencia: `docs/evidencia-5-10-pastilla.png` (cartel +
`⊕` sobre la línea ámbar, con la carta pintada). Sonda del flujo: `tools/sonda-5-10.js`.

**Lo que queda abierto de este vídeo**: que el número del cartel sea un **campo editable en el lienzo**
(como el suyo, que se teclea ahí) - nosotros abrimos el billete, que es el camino que ya valida y coloca -;
y que el cartel aparezca siguiendo la cruz del cursor durante el ajuste en vez de quedarse en la barra de
creación.

#### 5.10 · segunda pasada (quinto enlace al mismo vídeo)

Releído el fotograma a 4800×2700 con la anatomía completa (`/tmp/vf2`, t=9,5–19,5 s):

- **El cartel de la orden** lleva la palabra del tipo en una caja **rellena del color del lado** (verde si es
  largo, rojo si es corto) con el texto en blanco (`Limit` en rojo en el vídeo), y el centro dice
  `lado · precio / tamaño` (`Open short 64,216.6 / 0.1592`). Aquí: `Límite | Largo 68,007.40 / 50% | ×`.
  El tamaño va en la unidad del formulario (`%`, `uds` o `USD`): las pendientes no guardan la cantidad en
  monedas y no la calculamos a ciegas. Verde/rojo son `#24c18d`/`#f14b3f`, medidos en el sitio.
- **Lo que NO se copia**: los botoncitos `TP` / `SL` del cartel. El motor no tiene setter de SL/TP sobre una
  orden pendiente (sólo sobre la posición), y un botón que no hace nada sería mentira.
- **El billete**: su cabecera del vídeo es el saldo (`Available 3,946.1 USDT ⇄`), no un rótulo repetido. La
  nuestra pasa a `Balance libre <saldo>`, leído de `#acFree`, el mismo número que el panel.
- **Repintado por escala (defecto de esta pasada)**: tras un arrastre la escala se asienta después del
  `mouse.up`, y el overlay no se repintaba si no cambiaban los handles: la pastilla quedaba en su fila vieja.
  `_drawTradeHandles` ahora compara la `y` de cada handle con la última pintada y, si cambió, pide otro repintado
  en el siguiente frame (tope de 8).
- **Móvil**: el JS pone `right:auto` en línea al abrir el billete; con `width:auto` el panel se encogía a su
  contenido. La regla del móvil lleva `!important` en `right`, así el billete vuelve a ocupar la carta.

**Contrato**: anclas nuevas en el bloque L: la palabra sobre el relleno del lado, el centro con lado/precio/tamaño,
y **el bitmap del lienzo** con el chip justo en la fila del precio (centro 184, librería 184). `test:bitunix`
**294 ✓ · 0 ✗**; vecinos verdes (`limite-arrastrar` 26, `dibujos` 18, `gesto` 12, `responsive` 200, `formulario` 33,
`limites` 14, `hedge` 74, `dom.smoke` 51, `browser.capture` 47).

**Lo que la captura engaña (y por eso el ancla va al bitmap)**: en el navegador headless, dos capturas de la
misma escena separadas 1,5 s dieron la pastilla en la fila 194 y en la 110, mientras el lienzo y el estado
decían 194 todo el rato. La prueba que vale es la del bitmap (`getImageData` en el centro del chip); la captura
de evidencia se toma tras dos `requestAnimationFrame`, con las velas cargadas (servidor de código en 8080; el
build `file://` sale sin velas porque el reproductor no carga H.264 aquí).

**Pendiente visible**: el `⊕` del eje tapa parte de la etiqueta del precio de la orden (`68,007.40`). Viene de
§5.9 (el disco pegado al eje, como en el vídeo); el vídeo tiene el mismo solape, pero no lo tomamos como
argumento para dejarlo.

#### 5.10 · tercera pasada (sexto enlace al mismo vídeo, fotograma t=18,5 a 4800×2700)

- **Etiqueta del eje de la orden pendiente**: en el vídeo es una caja OSCURA con el precio en el color del lado
  (`64,175.1` en verde, la posición `64,088` en rojo), no una lima rellena. Ahora `axisLabelColor` = `#1a1b1c` y
  `axisLabelTextColor` = verde/rojo según el lado. Anclado en el bloque L (`295 ✓ · 0 ✗`).
- **Lo que queda aproximado**: el vídeo pone un borde fino del color del lado alrededor de esa caja; la librería
  no pinta bordes en la etiqueta del eje, así que la caja sale sin borde.
- **Lo que NO se cambia**: la línea sigue en lima (`COLORS.limit`, «lima de la marca»). En el fotograma la línea
  del Trigger es gris discontinua, pero eso es un estado de creación, no una orden colocada; cambiar el color de
  marca sin medirlo en el sitio sería inventar.

#### 5.10 · cuarta pasada (séptimo enlace al mismo vídeo; fotogramas t=15,5 y t=17 a 4800×2700)

- **El `⊕` va PEGADO POR FUERA del eje de precio.** En t=15,5 el menú de la línea termina justo a la izquierda de la
  columna de etiquetas; el nuestro iba en `w−26`, encima de la etiqueta del precio (`68,007.40`) y la tapaba. Ahora
  `x = w − ancho_del_eje − 24 − 2`, con el ancho del eje medido por la librería (`CM.main.priceScale('right').width()`,
  74 px en 1440). El margen derecho del cartel usa el mismo ancho. Anclado: el disco termina donde empieza el eje.
- **Lo que no se ve en el vídeo y no se inventa**: el disco en el trigger de creación (t=17): ahí no hay `⊕`, sólo el
  cartel en modo borrador. Sale únicamente en las órdenes ya colocadas, y así lo tenemos.
- `test:bitunix` 295 ✓ / 0 ✗; vecinos verdes (`limite-arrastrar` 26, `dibujos` 18, `gesto` 12, `responsive` 200,
  `formulario` 33, `limites` 14, `hedge` 74, `dom.smoke` 51, `browser.capture` 47).

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

