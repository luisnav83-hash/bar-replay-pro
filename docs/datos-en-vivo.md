# Datos en vivo (botón «En vivo»)

**Qué hace.** Muestra las velas reales de Binance de la temporalidad elegida, con el cursor en la vela
en curso. Cada 5 s consulta las dos últimas velas: actualiza la vela en curso y, si se abre una nueva,
rehace la serie por la misma ruta que la carga normal.

**De dónde salen los datos.** API pública de Binance (`/api/v3/klines`), sin claves ni cuenta. Se usan
los mismos hosts que la descarga de historial (`DS.BINANCE_HOSTS`).

**Qué NO hace.**
- No envía órdenes a ningún sitio. Las operaciones siguen siendo del simulador (`TradingEngine`), pero
  sobre este precio real.
- No es Bitunix: su API no tiene entorno de pruebas ni demo, y la demo de su app no es accesible por API.
- No mantiene conexión por WebSocket: consulta por HTTP cada 5 s. Basta para velas de 1 h o más; para
  1 min la vela se ve con hasta 5 s de retraso.

**Comportamiento.**
- Pulsar «En vivo» carga 1000 velas y deja el cursor en la última. El replay no se pone a reproducir.
- Cambiar par o temporalidad mientras está activo reinicia el modo con el nuevo par.
- «Cargar datos» lo detiene: la carga histórica no se pisa.
- Si Binance no responde, se reintenta cada 5 s y se avisa tras 3 fallos seguidos.

**Pruebas.** `tests/vivo.test.js` (12 comprobaciones) usa respuestas de Binance simuladas, así que no
depende de la red. Comprobado también contra Binance real: la vela en curso cambió de cierre
(83011.72 → 83011.71) con el cursor en la última vela y sin errores de JavaScript.
