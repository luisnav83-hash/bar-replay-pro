# Cómo se opera en los futuros de Bitunix — estudio para replicarlo aquí

> **Método.** Todo lo de abajo sale de la documentación pública de Bitunix (centro de ayuda, curso de
> futuros y `api-docs`), leída el 2026-10-10. Lo que **no** está documentado se marca como
> *pendiente de medir* en vez de inventarlo: un número inventado en un backtester es peor que no
> tenerlo, porque el usuario lo lee como comportamento real del exchange.

**Fuentes usadas** (todas de `bitunix.com`, salvo nota):

| # | Documento | Para qué sirve aquí |
| --- | --- | --- |
| F1 | [Bitunix Futures All Order Types Trading Guide (Web)](https://www.bitunix.com/hub/helpcenter/article/bitunix-futures-all-order-types-trading-guide-web?id=192) | tipos de orden y su flujo en el panel |
| F2 | [Guía de terminología de la página de futuros (App)](https://www.bitunix.com/hub/academy/course/futures-essential-course-understand-the-nouns-on-bitunix-futures-trading-page-in-one-article-app?id=82) | **los nombres literales** de cada campo y botón del panel |
| F3 | [Guía de terminología (Web)](https://www.bitunix.com/hub/academy/trading-guide/futures-independent-trading-quick-start/futures-essential-course-understand-the-nouns-on-bitunix-futures-trading-page-in-one-article-web) | barra superior, mark vs index, funding |
| F4 | [Cuatro métodos de TP/SL](https://www.bitunix.com/hub/academy/essential-beginners-guide/futures-trading-guide/bitunix-futures-positions-guide-to-four-tp-sl-methods) | Position · Partial · Trailing · Account |
| F5 | [Cómo configurar y modificar TP/SL](https://blog.bitunix.com/en/2024-06-25/how-to-set-up-and-modify-take-profit-and-stop-loss-on-bitunix/) | trigger ≠ ejecución; market vs limit execution |
| F6 | [Mantenimiento de margen por niveles](https://www.bitunix.com/hub/helpcenter/article/bitunix-futures-tiered-maintenance-margin-rate-rules?id=78) | **las fórmulas** de MM y de margen disponible |
| F7 | [`place_order` (API)](https://www.bitunix.com/api-docs/futures/trade/place_order.html) · [`modify_order`](https://www.bitunix.com/api-docs/futures/trade/modify_order.html) · [`get_order_detail`](https://www.bitunix.com/api-docs/futures/trade/get_order_detail.html) | el contrato exacto: parámetros, valores posibles, estados |
| F8 | [`get_pending_positions`](https://www.bitunix.com/api-docs/futures/position/get_pending_positions.html) · [`get_position_tiers`](https://www.bitunix.com/api-docs/futures/position/get_position_tiers.html) | campos de la posición y tabla de niveles/riesgo |
| F9 | [Panel rápido del gráfico](https://www.bitunix.com/hub/helpcenter/article/quick-panel-order-placement-guide?id=194) · [Plantillas de trading](https://www.bitunix.com/hub/helpcenter/article/chart-trading-custom-trading-templates?id=195) | qué se pone desde el gráfico y qué se guarda |

---

## 1 · El contenedor: tres modos que son independientes

Bitunix separa tres interruptores que en la mayoría de los terminales se confunden:

| Interruptor | Valores | Dónde se nota |
| --- | --- | --- |
| **Modo de margen** | *Full Position Mode* = **Cruzado** · *Position-by-Position Mode* = **Aislado** (F2) | en cruzado todas las posiciones del mismo activo comparten el margen disponible; en aislado cada posición usa margen propio y **se puede añadir o quitar margen a mano** (F2, F6) |
| **Modo de posición** | `ONE_WAY` (una vía: el mismo símbolo no puede estar long y short a la vez) · `HEDGE` (dos vías) (F7, F8) | en hedge toda orden lleva `tradeSide = OPEN \| CLOSE` y, al cerrar, `positionId` (F7). Es el motivo por el que la API obliga a esos dos campos |
| **Modo de activos** | margen en una sola moneda (USDT) · multi-activo / *combined margin* (F3, artículos 80/82/83) | cambia qué colateral vale y con qué descuento; **aquí no se replica** (ver §10) |

El apalancamiento se ajusta **por dirección** (F1): el diálogo de apalancamiento tiene
«Adjust Long and Short Leverage Simultaneously» —desmarcado, long y short tienen apalancamiento
distinto—. Además hay un **apalancamiento de orden** (artículo 237) separado del de la posición.

## 2 · El riesgo: la cuenta de Bitunix, no la de un libro de texto

De F6, literal:

```
Maintenance Margin      = Open Price · Size · Maintenance Margin Rate
Available Margin        = Initial Margin − PnL
Liquidación             cuando Available Margin < Maintenance Margin
```

Y de F8, la tabla de niveles (`get_position_tiers`), con el ejemplo que da la propia API:

| level | startValue | endValue | leverage (máx) | maintenanceMarginRate |
| --- | --- | --- | --- | --- |
| 1 | 0 | 50 000 | 125 | **0,004** |
| 2 | 50 000 | 200 000 | 100 | **0,005** |

Reglas que se leen de F6 y que importan para implementarlo:

* **Cuanto mayor es la posición, mayor el MMR y menor el apalancamiento máximo.** El apalancamiento
  pedido por el usuario es un **techo**, no un derecho: si el nivel no lo permite, no se puede subir.
* En **aislado** el tamaño, el nivel y el MMR se calculan **por dirección y por contrato**; en
  **cruzado** se calculan **juntos todos los lados** del contrato.
* `liqPrice ≤ 0` **no es un error**: significa que la posición está a tan poco riesgo que no tiene
  precio de liquidación dentro del dominio positivo del precio (F8). Un terminal que pinte «0» o
  «—» sin explicación está mintiendo sobre la semantics del campo.
* F2 documenta que BTC/USDT y ETH/USDT llegan a **200×** tras la actualización de los perpetuos,
  mientras que el ejemplo de niveles de la API dice 125× en el nivel 1: las dos cifras son reales y
  miden cosas distintas (techo del producto vs techo del nivel 1 del ejemplo). Aquí se usa **la tabla
  de niveles** como manda la mecánica, y el techo del producto solo como límite superior del deslizador.
* **Pendiente de medir**: la tabla completa de niveles de BTCUSDT (cuántos niveles hay por encima de
  200 000 y con qué MMR). La implementación deja el mapa inyectable y documenta de dónde sale.

## 3 · Mark, Index y funding

De F3, y es la clave para que un TP/SL se dispare o no:

* **Index price**: media ponderada del spot en varios exchanges. Sirve para la **justicia del precio**
  y para calcular el **funding**.
* **Mark price**: precio de referencia para **uPnL y liquidación**, justamente para que una mecha rara
  de un solo mercado no liquide posiciones.
* De ahí que toda orden condicional de Bitunix lleve **dos precios distintos** (§5, §6): el de *disparo*
  y el de *ejecución*, y que el disparo se pueda medir **contra mark o contra last** (`tpStopType =
  MARK_PRICE | LAST_PRICE`, F7). En un panel que solo sabe de velas, elegir «last» o «mark» cambia
  qué toca la vela: last mira los extremos (high/low), mark el precio de referencia de la vela.
* **Funding**: cada **8 horas**, con liquidación a las **08:00, 16:00 y 00:00 (UTC+8)**; tasa positiva
  → **los largos pagan a los cortos**, negativa → al revés (F3). Se aplica sobre el **notional**
  (el ejemplo de F3: 10 000 USDT × 0,0074 % = 0,74 USDT). Contratos nuevos o ilíquidos pueden
  liquidar **cada hora** (F3).

## 4 · Comisiones

`roleType: TAKER` aparece en el histórico de fills (F7 ⇒ `get_history_trades`), y las guías hablan de
maker/taker en el cierre de TP/SL: **el que cruza el libro paga taker, el que aporta liquidez paga
maker** (artículo 224). Los porcentajes exactos por nivel de cuenta **no** se citan en los documentos
leídos ⇒ se dejan configurables y se marcan como pendientes, en vez de poner 0,02 %/0,06 % «porque es
lo habitual». Lo que sí está documentado y se aplica:

* una orden **límite cuyo precio ya está cruzado se ejecuta inmediatamente al mejor precio** (mejor
  aún que el límite), y eso la hace *taker* (F2/BingX describe el mismo mecanismo; Bitunix lo hace
  igual: F1 «cuando introduces best market price, la orden se coloca en cuanto se alcanza el trigger»).
* POST_ONLY existe como `effect` (F7) y su única razón de ser es **cobrar maker**: si la orden
  cruzaría, no se coloca.

## 5 · Las órdenes: el contrato exacto de `place_order` (F7)

| Campo | Valores | Nota para la réplica |
| --- | --- | --- |
| `symbol` | p. ej. `BTCUSDT` | — |
| `side` | `BUY` / `SELL` | en la WS interna: 1 = Sell, 2 = Buy |
| `orderType` | `LIMIT` · `MARKET` | **el precio solo es obligatorio en LIMIT** |
| `qty` | cantidad en **moneda base** | la UI ofrece unidades (F170): contratos, moneda o USDT —aquí: % del equity, USD y cantidad ✓ |
| `price` | string | — |
| `effect` | `GTC` (default) · `IOC` · `FOK` · `POST_ONLY` | **obligatorio en órdenes límite**, es la validez |
| `tradeSide` | `OPEN` / `CLOSE` | solo en `HEDGE`; `CLOSE` necesita `positionId` |
| `reduceOnly` | bool | cerrar/reducir sin poder abrir posición contraria |
| `clientId` | string | id propio |
| `tpPrice` + `tpStopType` + `tpOrderType` (+ `tpOrderPrice`) | trigger, `MARK_PRICE`/`LAST_PRICE`, `LIMIT`/`MARKET` | ídem con `sl*` |

Estados de la orden (F7/F8): `INIT` → `NEW` → `PART_FILLED` → `FILLED` / `CANCELED`
(+- `PART_FILLED_CANCELED`). Tipos de orden en el selector del panel (F1): **Limit, Market, Trigger
y Trailing Stop**; la orden *trigger* admite ejecutarse como límite o a mercado, con **precio de
activación opcional** en el caso del trailing.

Una *trigger order* (F1) es: «cuando el precio de mercado llegue al **trigger price**, coloca una
orden (límite o mercado)». **No congela margen antes de dispararse** (F2/BingX y F1 son consistentes:
al disparar puede fallar por margen, precio o tamaño). Esto es importante y aquí no se imitaba:
una orden condicional **no** reserva saldo, y **puede no ejecutarse**.

## 6 · TP/SL: cuatro métodos y la diferencia entre disparar y ejecutar

De F4/F5, el modelo completo:

| Método | Unidad de control | Qué pasa al disparar |
| --- | --- | --- |
| **Position TP/SL** | la posición entera | cierra **toda** la posición |
| **Partial TP/SL** | un **%** del tamaño | cierra ese %, con **varios niveles** (ej.: 30 % en 65 000, otro 40 % en 68 000) |
| **Trailing TP/SL** | la posición | se activa al llegar al **precio de activación** y cierra al **retroceso** configurado por **Ratio** o **Interval** |
| **Account TP/SL** | **toda la cuenta de futuros** | cierra **todas** las posiciones cuando el PnL total (en importe o en %) toca el umbral |

Reglas que se repiten en F4/F5 y que hay que respetar:

* **El trigger y la ejecución son cosas distintas.** `tpPrice` dispara; `tpOrderType` decide si se
  ejecuta **a mercado** («prioriza ejecutar, el precio final puede variar») o **como límite** con
  `tpOrderPrice` («más control, puede no rellenarse»). Un TP/SL «ejecutado a precio de trigger» es el
  modo optimista; el pesimista debe poder decir **qué precio usó y por qué**.
* Para un **long**: el trigger de TP está **por encima** y el de SL **por debajo** del precio; para un
  **short**, al revés (F2/BingX, mismo criterio). Es la validación que ya hace este proyecto.
* Configurar TP/SL **congela el margen o la cantidad de posición** correspondiente, y se puede
  **modificar o cancelar** hasta que dispare (F2/BingX + F5).
* Hay **dos sitios** donde se ponen: en el panel de órdenes **antes** de abrir (van con la orden:
  `tpPrice`/`slPrice` en `place_order`) y desde la fila de la posición **después** (F5: Positions →
  TP/SL, con su propio cantidad). Y en el gráfico, arrastrando (F9).
* El **slider del panel de posición** puede fijar el nivel por **tasa de retorno o % de cambio de
  precio** en lugar de por precio absoluto (F4/F5: «introduce el precio de disparo **o** mueve el
  deslizador con el retorno esperado»). Eso es exactamente lo que aquí se guarda en las plantillas.

## 7 · El panel de posiciones: los campos, con sus nombres literales (F2)

`Positioning` · `BTCUSDT` · `Short` · `Cross` · `200×` · `Unrealized PnL (USDT)` · `ROI` ·
`Position (BTC)` · `Margin (USDT)` · `Margin Rate` · `Entry Price` · `Mark Price` ·
`Estimated Liquidation Price` · `Realized PnL (USDT)` — y los botones **`TP / SL`**,
**`Add Position`**, **`Close`** y **`Close All`** («cierra todas las posiciones del contrato al mejor
precio disponible, salida rápida»).

`ROI` es el retorno **sobre el margen**, no sobre el notional (F2: +2,42 % con ese margen), y
`Margin Rate` es margen / valor de la posición: **cuanto más alto, menos riesgo** (F2, F3: «margin
ratio vs maintenance margin: caer por debajo de mantenimiento dispara la liquidación»).

## 8 · Lo que el gráfico añade (F9, F12, F13, F18)

* El **panel rápido** del gráfico ofrece tres modos: **Limit Order, Trigger Order y TP/SL** (F9), con
  un botón «+» junto a la vela y también por **clic derecho** sobre el precio.
* La barra de estado inferior del gráfico tiene el deslizador de **TP/SL** con un conmutador
  **`E` = posición entera / `P` = posición parcial** (F9): arrastrar con `P` elige **qué cantidad**
  de la posición se cierra en ese nivel.
* Existen **plantillas de trading** (artículo 195: lo que ya se implementó aquí) y **plantillas de
  dibujo** (245), **TP/SL parcial vinculado** (304), **control por lotes de TP/SL** (253),
  **riesgo fijo** (225 y 223: el tamaño se deriva del riesgo admitido) y **escalera de órdenes**
  (*scaled order*, 229/240) y **bloqueo de posición** (266).

## 9 · Brechas con este terminal, y decisión

| Capacidad de Bitunix | Aquí hoy | Decisión |
| --- | --- | --- |
| `effect` GTC/IOC/FOK/POST_ONLY en órdenes límite | no existe; un límite cruzado se ejecuta a mercado siempre | **implantar**: POST_ONLY rechaza si cruzaría; IOC coloca solo lo ejecutable ya; FOK todo-o-nada |
| Orden **Trigger** (plan) con trigger + ejecución límite/mercado | solo Límite y Mercado | **implantar** como tercer tipo del selector, sin congelar margen y pudiendo fallar al disparar |
| Disparo TP/SL **contra mark o last** | solo contra extremos de la vela | **implantar**: `mark` = precio de referencia de la vela, `last` = high/low |
| Ejecución TP/SL **market o limit** (+ precio) | implícita | **implantar**: con límite puede **no rellenarse** y la posición sigue viva |
| **MMR por niveles** + apalancamiento máximo por nivel + `liqPrice ≤ 0` | margen de mantenimiento despreciado (así lo dice el comentario de `liquidationPrice`) | **implantar** la fórmula de F6 y la tabla de F8, con mapa inyectable |
| Funding cada **8 h** a 00/08/16 UTC, **largo paga / corto cobra** | `%` por vela y cobra a ambos lados | **implantar** el modelo real; el signo por lado es un defecto que se corrige |
| `reduceOnly` | no existe | **implantar** en la orden y en el cierre |
| `Close` por % y **`Close All`** a mercado en la fila de posición | atajo `C` (50 %) y «Cerrar todo» en la carta | **ajustar** nombres y que `Close All` sea a mercado explícito |
| **Trailing** con precio de activación y retroceso **Ratio o Interval** | trailing por % con activación por beneficio | **ampliar** al modo intervalo |
| **Account TP/SL** (toda la cuenta, por importe o %) | no existe | **capa 3** |
| **Partial TP/SL** con % por nivel | TP escalonado (`addTpLevel(price, pct)`) ✓ | ya está; falta el **deslizador de retorno** del panel de posición |
| Modo **hedge** (`ONE_WAY`/`HEDGE`, `tradeSide`, `positionId`) | una sola posición (one-way) | **capa 4**, es el cambio grande del motor |
| Apalancamiento **por dirección** | un solo valor | **capa 3** |
| Tick del precio (F2: `0.1` en BTCUSDT, precios a un decimal) | se redondea a 6 decimales | **implantar**: `tickSize`/`stepSize` por símbolo y entrada snapped, con el tick visible |
| Multi-activo / combined margin, descuento de colateral, tiers reales por símbolo, ADL, depth real | n/a | **no se replica** (un backtester de OHLC no tiene libro real): se documenta en §11 |

## 10 · Capas de implementación y cómo se comprueba cada una

1. **Capa 1 — el riesgo y las condiciones (motor).** MMR por niveles y liquidación según F6; funding de
 8 h con signo por lado; `effect`; orden trigger; disparo mark/last y ejecución market/limit;
  `reduceOnly`; tick/step. **Verificación:** suite de Node **sin navegador** con velas sintéticas
  (`tests/futuros.test.js`), que es lo único determinista: cada regla se comprueba con una vela
  diseñada para tocar o no tocar el nivel. **✅ Capa 1 implementada y verde: 78 comprobaciones en
 `tests/futuros.test.js` (bloques A-I), y las suites que fijaban la fórmula vieja actualizadas a F6
 (`logic` 160, `bitunix` 134).**
2. **Capa 2 — el formulario.** Selector de tipo con **Trigger**, filas de «Disparo», «Ejecución» y
  «Validez», precio de activación y retroceso del trailing, tick visible, `reduceOnly`, y «Cerrar
  todo»/«Cerrar %» en la carta de posición con los nombres de F2. **Verificación:** suite de
  navegador sobre el archivo único, manejando solo la UI (como las demás).
3. **Capa 3 — los cuatro TP/SL completos y riesgo fijo.** Account TP/SL (umbral de cuenta por importe
  o %) y sizing por riesgo admitido (F223/225), apalancamiento por dirección.
4. **Capa 4 — modo de posición.** `ONE_WAY` ⇄ `HEDGE` con `tradeSide`/`positionId`, lo que obliga a
  cambiar el modelo de «una posición» a «posiciones por lado» en motor, cartas, historial y PnL.

## 11 · Límites honestos de la réplica

* **No hay libro real**: un backtester con OHLC no puede decidir rellenos parciales, slippage ni si
  tu límite quedó por delante o por detrás de la cola. IOC/FOK se implementan con la semántica que sí
  se puede decidir (¿se cruza ahora? ¿hay margen?) y el resto se avisa, no se finge.
* **Mark e Index** no existen como series propias: aquí `mark` = el precio de referencia de la vela y
  `last` = los extremos. La **distinción de comportamiento** (qué toca el trigger) sí es exacta; los
  valores, no, y no se vende como si lo fueran.
* La **tabla de niveles** de BTCUSDT tiene solo dos filas documentadas en F8 (el ejemplo de la API);
  por encima de 200 000 no hay datos medidos ⇒ el mapa es inyectable y la UI dice de dónde sale.
* **Comisiones maker/taker**: la mecánica (quién es maker) sí se implementa; los porcentajes por
  nivel de cuenta quedan pendientes de medir y no se inventan.
* **Liquidación real**: Bitunix liquida y luego subasta/ADL; aquí la posición se cierra al precio de
  liquidación calculado. Se documenta en el propio panel, como el resto de simplificaciones del motor.

## 12 · Estado de la capa 1 (motor) y decisiones tomadas al implementarla

| Pieza | Dónde | Regla replicada |
|---|---|---|
| Niveles y MMR | `TE.nivel`, `TE.margenMantenimiento` | tabla inyectable; `MM = \|entrada·qty·MMR\|`, MM sobre el **nocional de entrada** |
| Liquidación | `TE.liqInfo`, `TE.liquidationPrice` | `L = e − dir·(margen + libre−MM)/qty`; `L ≤ 0` ⇒ `sinNivel` (el `liqPrice ≤ 0` de la API), **no** se pinta 0 |
| `marginRate` | `TE.marginRate` | `enRiesgo` es `disponible < mantenimiento` (**no** `ratio < MMR`: son magnitudes distintas y a 90,47 divergen) |
| Disparo mark/last | `TE._alcanza` | `last` usa las mechas, `mark` el cuerpo de la vela |
| Ejecución del nivel | `TE._ejecutaNivel` | `MARKET` cierra; `LIMIT` **coloca** una orden reduce-only que puede no rellenarse nunca |
| `effect` | `TE.placeLimit` | GTC/IOC/FOK/POST_ONLY; maker/taker por si llegó cruzado; fee de maker solo si está medida |
| Reduce-only | `TE._reduceOnly` | se retira si no hay posición o si el lado añadiría; ≥99,9 % cierra todo |
| Trigger | `TE.placeTrigger/_checkTrigger/_fillTrigger` | no reserva margen al esperar (por eso puede rechazarse al disparar); con `exec:'limit'` el límite solo puede rellenarse desde la vela siguiente |
| Funding | `TE._siguienteFunding` | cada 8 h en 00/08/16 **UTC** sobre el **nocional**, con signo por lado; la agenda se ancla a `p.entryTime`, no a la primera vela; una vela que cruza N liquidaciones paga N |

Tres decisiones que no estaban escritas en la documentación y se tomaron aquí:

1. **Mover un TP/SL cuyo disparo ya había colocado la orden de cierre la SUSTITUYE** (no acumula dos).
   La API tiene `modify_order` para exactamente eso; dos cierres del mismo nivel cerrarían el doble de
   la posición, un estado imposible en el exchange.
2. **`niveles: null` es el modelo clásico**, no un borrado: la fórmula antigua sale como caso
   particular con MM = 0, así que las cuentas viejas y el snapshot siguen cuadrando.
3. **Los rellenos de una orden disparada por nivel usan el precio PEOR plausible** (`max(open,nivel)`
   al comprar, `min(open,nivel)` al vender). Con OHLC no se sabe el orden interno de la vela; el
   pesimismo es lo que hace el propio `slFirst: 'worst'` del proyecto.

Números de referencia de la suite (capital 10 000, long 100 %, 10×, entrada 100 ⇒ nocional 100 000,
qty 1 000, nivel 2, MM 500): liquidación aislada **90,50**; a 90,40 `disponible 400 < mant. 500` (con
`Margin Rate` pintado en 0,5525 % > MMR 0,5 %); PnL de liquidación **−9 690,50** y saldo **309,50** —
queda el mantenimiento, no se va a cero—; funding al 0,01 % = **10 USDT** por liquidación.
