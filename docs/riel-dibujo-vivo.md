# Riel de dibujo: candado y ojo (pasada del vídeo, fotograma t=12)

**Qué enseña el fotograma (4800×2700).** El riel del sitio es vertical, con iconos y tres grupos separados
por filetes: herramientas de dibujo; regla y zoom; imán, lápiz con candado, candado y ojo. El riel
real también se corta al pie de la ventana (su candado sale a medias): no cabe entero, se desplaza.

**Qué se copia.**
- **Candado** (`#btnLockDrawings`): bloquea TODOS los dibujos. Un dibujo bloqueado no se selecciona, no
  se mueve y no se borra. Las órdenes y las líneas de posición no son dibujos y siguen funcionando.
  El botón enseña el estado: 🔓 abierto, 🔒 bloqueado, con `aria-pressed`.
- **Ojo** (`#btnHideDrawings`): oculta o muestra todos los dibujos, sin borrarlos. Usa la misma función
  (`DT.toggleAllHidden`) que el gestor de dibujos.

**Qué no se copia todavía.** Los iconos son emojis, no los trazos del sitio; el riel sigue siendo
horizontal en escritorio (la versión vertical es una decisión de maquetación aparte); el lápiz con candado
(bloquear un dibujo concreto) no existe: el candado actual es global.

**Un riel más alto que la ventana.** Con 21 botones, a 900 px de alto sobran 49 px: el riel se desplaza en
vertical (`overflow-y: auto`), como ya pedía el CSS. La comprobación de la suite pedía que no sobrara nada;
se cambió para exigir lo que importa: que se desplace, que el botón siga pulsable y que estén todos.

**Pruebas.** `tests/riel.test.js` (11 comprobaciones): estado inicial, bloqueo (no selecciona ni borra),
desbloqueo, ojo que oculta y muestra sin borrar. Limitación: el punto del dibujo de prueba cae en x=0 (fuera
de la vista en ese momento), así que la comprobación de selección se apoya en que la línea horizontal ocupa
todo el ancho; no prueba la posición.
