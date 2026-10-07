# 📈 Bar Replay Pro — Backtesting vela a vela de Bitcoin y criptomonedas

Aplicación web completa para **practicar trading en tiempo simulado**: carga velas
históricas reales de Binance, oculta el futuro y te deja avanzar la gráfica
**vela a vela** mientras dibujas, analizas y operas con dinero virtual. Al terminar
obtienes estadísticas profesionales de tu rendimiento (win rate, profit factor,
drawdown, curva de capital y más).

![tema](https://img.shields.io/badge/tema-terminal%20de%20trading-1a1a2e) ![sin dependencias](https://img.shields.io/badge/backend-sin%20dependencias-00c853) ![licencia](https://img.shields.io/badge/licencia-MIT-2979ff)

---

## ✨ Funcionalidades

### 1. Gráfico de velas
- Renderizado con **TradingView Lightweight Charts v4** (incluida localmente en `vendor/`).
- Temporalidades: **1m · 5m · 15m · 1h · 4h · 1d · 1w**.
- Zoom, scroll, cruceta con precio/fecha, escala **automática o manual** (fija),
  escala **lineal o logarítmica**, velas alcistas en verde y bajistas en rojo.
- Bloqueo opcional del scroll para no mover la vista sin querer.

### 2. Sistema de Bar Replay
- **PLAY / PAUSA**, **avanzar** y **retroceder** una vela, **reset** al inicio y salto al final.
- Velocidades **0.5x · 1x · 2x · 5x · 10x · 50x · MAX** (bucle con `requestAnimationFrame`
  y acumulador: nada se pierde aunque la pestaña se ralentice).
- Barra de progreso arrastrable, reloj de la vela actual (UTC) y **contador de velas ocultas**.
- Las velas futuras **nunca** se envían al gráfico: solo se dibuja hasta el cursor.
- Al **retroceder**, la cuenta se reconstruye desde *checkpoints*: balance, historial
  de trades y posición vuelven exactamente al estado de esa vela.

### 3. Herramientas de dibujo (persistentes)
Línea de tendencia · línea extendida · soporte/resistencia horizontal · línea vertical ·
rectángulo/zona · **canal paralelo** (3 clics) · **retroceso de Fibonacci** ·
**medición** (Δprecio, Δ%, nº de velas y tiempo). Color, grosor y estilo configurables,
selección y arrastre con el ratón, imán a OHLC de las velas, borrado individual o total.
Los dibujos se anclan a **tiempo + precio**, así que siguen en su sitio al hacer zoom,
scroll o avanzar el replay.

### 4. Indicadores técnicos (cálculo propio, sin librerías)
| Indicador | Parámetros | Panel |
|---|---|---|
| SMA | período | principal |
| EMA | período | principal |
| EMA 2 | período | principal |
| Bollinger | período + k desviaciones | principal |
| Volumen | color | principal (histograma inferior) |
| RSI (Wilder) | período | panel inferior |
| MACD | rápida / lenta / señal | panel inferior (línea + señal + histograma) |
| ATR (Wilder) | período | panel inferior |

Todos son **causales**: el valor de una vela solo depende de velas pasadas, así que
mirar el indicador nunca revela el futuro.

### 5. Trading simulado
- **BUY/LONG** y **SELL/SHORT** con tamaño en **% del equity**, **USD de exposición** o **cantidad**.
- **Capital inicial** configurable (por defecto 10.000 $) y **apalancamiento** 1x…50x
  con **precio de liquidación estimado**.
- **Stop Loss** y **Take Profit**: por precio, con atajos por % o **arrastrando las
  etiquetas SL/TP sobre el gráfico**.
- Ejecución automática de SL/TP durante el replay, con **modelo realista**:
  - si la vela toca SL y TP a la vez → modo **pesimista** por defecto (ejecuta el SL);
  - si hay **hueco (gap)**, la orden se rellena en la apertura de la vela (peor precio).
- **Comisiones** configurables (0,1 % por lado, ida y vuelta) y de **financiación**
  opcional por vela.
- PnL en tiempo real, líneas en el gráfico de entrada/SL/TP/liquidación y métricas
  del trade (MFE/MAE, R múltiplo, duración en velas y tiempo).

### 6. Estadísticas y resultados
Balance · equity · PnL total y abierto · margen usado y exposición · nº de trades ·
ganadores/perdedores · **win rate** · **profit factor** · **payoff** · expectancy ·
**R medio** · **máximo drawdown** ($ y %) · mejor y peor trade · rachas ·
**curva de capital** en vivo · tabla completa del historial (entrada, salida, dirección,
precios, tamaño, PnL, %, R, motivo de cierre y duración).

### 7. Gestión de datos
- **Binance** `/api/v3/klines` con **paginación automática** de 1000 velas y 6 hosts espejo.
- **Catálogo de símbolos** `/api/v3/exchangeInfo` (1.100+ pares reales) para el buscador,
  con proxy propio en `server.js` y caché de 6 h; si no hay red, lista local de 40 pares.
- **Fallback a CoinGecko** si Binance no está disponible.
- **Caché local** (localStorage) de lo descargado, con aviso de velas en caché.
- Importación de **CSV** (con o sin cabecera, separador `,`/`;`/tabulador, fechas ISO o epoch).
- Modo **Demo**: 3.000 velas sintéticas deterministas para practicar sin conexión.
- Selector de **rango de fechas** y de **par** con **BUSCADOR DE SÍMBOLOS** (botón
  del par o `Ctrl+K` / `/`): catálogo de Binance por **categorías** (⭐ Favoritos,
  🕘 Recientes, 🔥 Principales, 💵 USDT, USDC, BTC, ETH y todos), **búsqueda en vivo**
  por texto y ⭐ para marcar favoritos (se recuerdan en el navegador). 40 pares de
  referencia siempre disponibles aunque no haya red.

### 8. Extras
- **DIBUJAR MANTENIENDO PULSADO** (gesto, estilo tableta gráfica): mantén pulsado
  ⅓ s sobre el gráfico y traza una forma; al soltar, se reconoce sola y se
  convierte en el dibujo que parece: un trazo horizontal → soporte/resistencia,
  vertical → línea de tiempo, diagonal → línea de tendencia, cuatro lados →
  rectángulo/zona, un bucle → elipse, un zigzag → retroceso de Fibonacci.
  Un **garabato** encima de un dibujo lo borra. Mientras dibujas, el gráfico no
  se desplaza (se bloquea la panorámica). Se puede desactivar en Ajustes
  (`gestureDraw`). El reconocimiento es geométrico (giro acumulado, cierre,
  rectitud), sin librerías externas.
- **PANEL DE INDICADORES con valores en vivo** (estilo terminal de trading): la
  tarjeta «📈 Paneles» lista todos los indicadores con su valor actual —Vol, SMA,
  EMA, EMA2, BB, RSI, MACD (hist/macd/señal) y ATR— y se actualiza en cada vela
  del replay. Cada fila lleva punto de color, ojo 👁 para mostrar/ocultar la serie
  en el gráfico y abre la configuración al hacer clic.
- **ÓRDENES LÍMITE**: se colocan y esperan; el replay las ejecuta solas al llegar
  el precio (línea ámbar punteada + tarjeta «⏳ Órdenes pendientes» con botón ✖).
- **BUSCADOR DE SÍMBOLOS Y TEMPORALIDADES RÁPIDAS**: el botón del par abre el catálogo
  de Binance con categorías, buscador en vivo y favoritos ⭐; al lado, los botones
  `1m · 5m · 15m · 1h · 4h · 1d · 1w` cambian la temporalidad al instante. El par
  elegido se recuerda en «Recientes» y la leyenda del gráfico se sincroniza siempre.
  Si no hay datos para esa combinación, avisa y cae a las velas guardadas o a DEMO
  (nunca deja el gráfico desincronizado del par o la temporalidad elegidos).
- **Guardar/cargar sesiones** completas (replay, dibujos, indicadores, trades, cuenta).
- **Exportar**: trades a CSV · curva de capital a CSV · velas visibles a CSV ·
  sesión a JSON · **informe imprimible → PDF** (incluye captura del gráfico).
- **Captura de pantalla** del gráfico (velas + dibujos + paneles) en PNG.
- **Modo práctica rápida**: fecha aleatoria y a operar.
- **Atajos de teclado**, sonidos sintetizados (WebAudio) y diseño responsive.

---

## 🌐 Publicada en GitHub Pages

El repositorio incluye `.github/workflows/pages.yml`: al subirlo a GitHub, la app
se publica sola y queda accesible desde cualquier navegador (también móvil) en
`https://TU-USUARIO.github.io/TU-REPOSITORIO/`.

- Repositorio: **https://github.com/luisnav83-hash/bar-replay-pro**
- Aplicación completa: **https://luisnav83-hash.github.io/bar-replay-pro/**
- Archivo único (ideal para el móvil): **https://luisnav83-hash.github.io/bar-replay-pro/bar-replay-pro-unico.html**

Instrucciones paso a paso en **[SUBIR-A-GITHUB.md](SUBIR-A-GITHUB.md)**.

## 🎬 Vídeo de demostración

Grabado de la aplicación real (28 s, sin red, con las velas reales incluidas):
**[docs/demo-bar-replay.mp4](docs/demo-bar-replay.mp4)** · se regenera con `npm run demo:video`.

## 📸 Capturas

**Vista general** — replay en marcha con SMA/EMA, volumen, RSI y estadísticas:

![Vista general](docs/captura-00-portada.png)

**Operando el replay** — posición LONG con líneas de entrada, SL y TP arrastrables, dibujos
(lineal de tendencia y soporte) y velas futuras ocultas (🔒 contador):

![Operando](docs/captura-02-replay-operando.png)

**Indicadores en paneles sincronizados** — Bollinger, RSI, MACD y ATR:

![Indicadores](docs/captura-03-indicadores.png)

**Resultados** — historial completo con motivo de cierre, R múltiplo y duración:

![Estadísticas](docs/captura-05-estadisticas.png)

**Buscador de símbolos en vivo** — catálogo completo de Binance (1.183 pares) con
categorías, búsqueda al escribir, favoritos ⭐ y recientes 🕘:

![Buscador de símbolos](docs/captura-20-buscador-en-vivo.png)

**Dibujar manteniendo pulsado** — el gesto reconoce el trazo y lo convierte en
soporte/resistencia, línea de tendencia, rectángulo, elipse o Fibonacci:

![Gesto de dibujo](docs/captura-18-gesto-dibujo.png)

*(Generadas automáticamente por `tests/browser.capture.js` en Chromium headless.)*

---

## 🚀 Cómo ejecutarlo

### Opción A — Solo frontend (lo más rápido)
Abre `index.html` en el navegador o levanta un servidor estático:

```bash
cd bar-replay-app
python3 -m http.server 8080
# → http://localhost:8080
```

### Opción A′ — Archivo único, sin servidor ni instalación
`bar-replay-pro-unico.html` es **toda la aplicación en un solo archivo** (≈709 KB:
HTML + CSS + JS + la librería de gráficos incrustados). Se abre con doble clic,
se puede enviar por correo o incrustar en cualquier visor. Sin conexión arranca
en modo DEMO automáticamente.

```bash
npm run build:single     # regenera bar-replay-pro-unico.html desde las fuentes
npm run test:single      # lo verifica en un navegador real CON LA RED BLOQUEADA
```

### Opción B — Con backend Node (recomendado)
El servidor sirve la app y además **proxifica las velas de Binance** en
`/api/v3/klines` (útil si tu red bloquea Binance o hay problemas de CORS).
**No necesita dependencias**: usa módulos nativos de Node ≥ 18.

```bash
cd bar-replay-app
node server.js            # → http://localhost:8080
PORT=3000 node server.js  # otro puerto
```

Si tienes `express` instalado, `server.js` lo detecta y lo usa automáticamente
(`npm install express`). Comprueba el proxy con:

```bash
curl "http://localhost:8080/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3"
```

### Pruebas

```bash
npm test                    # lógica + DOM simulado
npm run test:net            # carga de velas reales (requiere red / server.js en marcha)
npm run test:browser        # navegador real + capturas en docs/ (requiere puppeteer)

node tests/logic.test.js      # 151 pruebas: indicadores, datos, trading, estadísticas y replay
node tests/dom.smoke.js       #  51 comprobaciones en navegador simulado (requiere jsdom)
node tests/boot.test.js       #  13 comprobaciones de arranque con red bloqueada
node tests/network.test.js    #  10 comprobaciones de paginación y datos reales de Binance
node tests/browser.capture.js #  48 comprobaciones en Chromium real + capturas PNG
node tests/iframe.test.js     #  22 comprobaciones dentro de un iframe sandbox (sin red)
node tests/preview-live.test.js # 17 comprobaciones del preview EN VIVO (datos reales vía proxy)
node tests/responsive.test.js #  50 comprobaciones de tamaño: 10 paneles, sin recortes
node tests/visor-sanitizado.test.js # 9 comprobaciones del visor que no ejecuta JS
node tests/limites.test.js    #  13 comprobaciones de las órdenes límite (ciclo completo)
node tests/gesto.test.js      #  12 comprobaciones del gesto de dibujo (traza con el ratón)
node tests/simbolos.test.js   #  27 comprobaciones del buscador de símbolos y las temporalidades
node tests/pages-buscador.js  #  10 comprobaciones de LA APP PUBLICADA (catálogo real sin servidor propio)
node tests/incidencias.test.js # 14 comprobaciones de los avisos de error y diagnóstico
node tests/single.test.js     # archivo único en navegador real sin red
```

Resultado actual: **437 comprobaciones, 0 fallos** ✅

> Los tests que necesitan servidor (`boot`, `iframe`, `preview-live`, `browser`) **detectan
> solos el puerto** donde escuche `server.js` (o aceptan `BASE_URL=http://host:puerto`).

`tests/dom.smoke.js` necesita jsdom (`npm install jsdom`; si no está se omite solo).
`tests/network.test.js` detecta si hay red o proxy y, si no la hay, se marca como
omitido en lugar de fallar.

---

## 🎮 Flujo de uso

1. Elige **par** y **temporalidad** → pulsa **Cargar datos** (o **Demo** si no hay red).
2. Indica la **fecha de inicio del replay**; verás el histórico previo como contexto y
   el resto oculto (contador «🔒 N velas ocultas»).
3. Avanza con **PLAY**, **▶▶** o el slider de velocidad; retrocede con **◀◀**.
4. Dibuja soportes, canales, Fibonacci… y activa indicadores en **📈**.
5. Abre **LONG/SHORT** con tamaño, apalancamiento, SL y TP (por precio, por % o
   arrastrando las etiquetas en el gráfico).
6. Observa el PnL en vivo; la posición se cierra sola por SL/TP/liquidación o con **Esc**.
7. Revisa **estadísticas**, **curva de capital** e **historial**, y **exporta** el informe.

### ⌨️ Atajos de teclado
| Tecla | Acción |
|---|---|
| `Espacio` | Play / Pausa |
| `→` / `←` | Avanzar / retroceder una vela |
| `B` / `S` | Comprar (Long) / Vender (Short) |
| `Mayús+B` / `Mayús+S` | Colocar **orden límite** de compra / venta |
| `T` | Alternar entre orden a **mercado** y **límite** |
| `Esc` | Cerrar posición (y cancelar dibujo/cerrar modales) |
| `R` | Reset del replay |
| `Supr` | Borrar el dibujo seleccionado |
| `+` / `-` | Subir / bajar velocidad |
| `1`…`9` | Seleccionar herramienta de dibujo |
| `Ctrl+S` | Guardar sesión |

---

## 📁 Estructura

```
bar-replay-app/
├── index.html                # Estructura de la interfaz (todo en español)
├── bar-replay-pro-unico.html # Build de un solo archivo (generado)
├── server.js                 # Backend opcional: estáticos + proxy de klines
├── package.json
├── css/responsive.css      ← TODAS las reglas de tamaño (se carga la última)
├── snapshot/velas-reales.json ← velas reales incrustadas (tools/snapshot.js)
├── css/
│   ├── main.css              # Variables del tema, layout, botones, tablas
│   ├── chart.css             # Área de gráfico, toolbar de dibujo, paneles, replay
│   ├── panels.css            # Barra lateral y panel inferior
│   └── modals.css            # Modales (indicadores, ajustes, sesiones, export…)
├── js/
│   ├── utils.js              # Formateo, fechas UTC, toasts, sonidos, descargas
│   ├── indicators.js         # SMA, EMA, RSI, MACD, Bollinger, ATR (puros)
│   ├── dataService.js        # Binance paginado, CoinGecko, CSV, datos demo
│   ├── storage.js            # localStorage: caché de velas, sesiones, ajustes
│   ├── statistics.js         # Métricas de rendimiento y exportaciones
│   ├── tradingEngine.js      # Cuenta, órdenes, SL/TP, liquidación, checkpoints
│   ├── barReplay.js          # Motor del replay (play/pausa/velocidad/seek)
│   ├── chart.js              # Gráfico principal, paneles y equity (Lightweight Charts)
│   ├── drawingTools.js       # Herramientas de dibujo sobre canvas
│   ├── uiController.js       # Cableado de la interfaz, modales y atajos
│   └── app.js                # Inicialización y orquestación
├── vendor/
│   └── lightweight-charts.standalone.production.js   # v4.2.0 (Apache-2.0)
├── tools/
│   └── build-single.js       # Genera el archivo único autocontenido
├── assets/
│   ├── icons/                # favicon.svg
│   └── sounds/               # (sonidos sintetizados con WebAudio)
└── tests/
    ├── logic.test.js         # Pruebas de lógica en Node (151)
    ├── dom.smoke.js          # Prueba de humo con jsdom (51)
    ├── network.test.js       # Carga de velas reales / paginación (10)
    ├── browser.capture.js    # Navegador real (Chromium) + capturas (43)
    ├── boot.test.js          # Arranque robusto sin red / sin localStorage (13)
    └── single.test.js        # Archivo único en navegador real sin red
```

---

## 🧠 Notas técnicas

- **Sin fuga de futuro**: el gráfico recibe solo las velas hasta el cursor. Los
  indicadores se calculan sobre la serie completa porque son **causales** (el valor de
  la vela *i* no depende de velas posteriores) — la prueba `logic.test.js` verifica
  esta propiedad explícitamente.
- **Rendimiento**: al avanzar una vela se usa `series.update()` (O(1)); al retroceder o
  saltar se reconstruye con `setData()`. El avance rápido agrupa varias velas por
  fotograma y los eventos de UI se silencian en lote (`TE.beginBatch/endBatch`) y se
  refrescan una sola vez. La caché limita a 6.000 velas por par/temporalidad.
- **Zona horaria**: todas las marcas de tiempo son **segundos UNIX en UTC**; los
  `datetime-local` se interpretan como UTC explícitamente.
- **Modelo de ejecución intrabar**: con OHLC no se conoce el orden de los precios dentro
  de la vela, así que la ambigüedad SL/TP se resuelve de forma **pesimista** por defecto
  (configurable en Ajustes) y los huecos se rellenan al precio de apertura.
- **Comisiones**: se cobran al abrir y al cerrar; el PnL del trade las incluye ambas,
  de modo que `balance = capital inicial + Σ PnL` siempre cuadra.
- **Reinicio por checkpoints**: cada vela avanzada guarda un estado compacto de la
  cuenta (balance, longitud del historial, copia de la posición abierta y longitud de la
  curva de capital), así retroceder es instantáneo y determinista.
- **Privacidad**: todo se ejecuta en tu navegador; no hay telemetría ni servidores
  propios. La caché y las sesiones viven en `localStorage`.
- **Arranque a prueba de bloqueos**: el orden de hosts prueba PRIMERO el proxy del
  mismo origen (respuesta en ~1,4 s con `server.js`), cada petición tiene un timeout
  de 6 s y todo el arranque un presupuesto de tiempo. Si la red no responde en 9 s,
  la app carga datos DEMO y sigue siendo totalmente usable (probado en
  `tests/boot.test.js` con un `fetch` que nunca contesta y `localStorage` bloqueado).
  Si los datos reales llegan más tarde y aún no has operado, se avisa con un toast.
- **Velas REALES dentro del archivo**: `bar-replay-pro-unico.html` lleva incrustadas
  4.000 velas reales de Binance (BTC/USDT 1h + 15m, ETH/USDT 1h) en
  `snapshot/velas-reales.json`. En un entorno sin internet la app **no** enseña
  datos inventados: usa esas velas reales (leyenda `· Binance (guardada)`).
  Para actualizarlas: `node server.js` + `node tools/snapshot.js` + `node tools/build-single.js`.
  Los datos sintéticos DEMO quedan solo como último recurso (pares/temporalidades
  sin instantánea), siempre señalados en ámbar.
- **A prueba de visores que "sanean" el HTML**: algunos visores (p. ej. la vista
  previa en móvil) eliminan las etiquetas `<script>` pero dejan su CONTENIDO, con lo
  que el código aparecía como texto suelto por la pantalla. Ahora el `<script>` va
  dentro de un contenedor oculto (`#brpJS`): si el visor borra las etiquetas, el
  código queda invisible; si el navegador es normal, se ejecuta igual. Además, el
  aviso de emergencia explica cómo abrir la app en un navegador de verdad.
- **Nunca se queda muda**: si el entorno bloquea JavaScript, aparece un cartel de
  emergencia que lo explica (`#brpNoJS`); si algo falla al arrancar, se muestra un
  informe rojo con el error exacto y 13 datos de diagnóstico (módulos cargados,
  almacenamiento, canvas, si está dentro de un iframe…) y un botón **Copiar informe**.
  El arranque es resistente a visores que inyectan el HTML ya cargado
  (`document.readyState !== 'loading'`).
- **Layout adaptable a CUALQUIER entorno**: el cuerpo es una columna flexible, así que
  el gráfico se ajusta al alto/ancho disponible. Verificado a 1680×950, 1280×700,
  900×700 y 480×900 con **0 px de desbordamiento** en todos los casos, manteniendo el
  gráfico ≥200 px de alto y los controles de replay/compra siempre accesibles
  (`captura-06-ventana-pequena.png`, `captura-10-movil.png`).
- **Funciona dentro de la sandbox de vista previa**: probado en un iframe con
  `sandbox="allow-scripts"` con internet externo bloqueado — la app carga **datos reales
  de Binance vía el proxy del mismo origen** de `server.js` (`captura-09-preview-sandbox.png`).

## ⚠️ Descargo de responsabilidad

Herramienta **educativa**. La simulación simplifica la realidad (liquidaciones, slippage,
profundidad de mercado, funding real) y los datos pueden contener errores de la fuente.
Nada de lo que muestra constituye asesoramiento financiero. Practica, aprende y arriesga
solo lo que puedas permitirte.

## 📜 Licencia

MIT. Incluye **TradingView Lightweight Charts v4.2.0** (licencia Apache-2.0, © TradingView Inc.)
y datos públicos de Binance/CoinGecko.
