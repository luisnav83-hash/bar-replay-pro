# assets/sounds

Los sonidos de la aplicación **se generan en tiempo real con la Web Audio API**
(`js/utils.js → U.playSound`): tonos cortos sintetizados para apertura, cierre,
ganancia, pérdida, clic y error. Así la app no depende de ningún archivo de audio
externo y funciona sin conexión.

Si prefieres usar tus propios archivos `.wav`/`.mp3`, colócalos en esta carpeta y
sustituye el cuerpo de `U.playSound(kind)` por:

```js
const audio = new Audio(`assets/sounds/${kind}.mp3`);
audio.volume = 0.35;
audio.play();
```

El sonido se puede activar/desactivar en **Ajustes → 🔊 Sonido al ejecutar órdenes**
(o con `U.sound.enabled = false` desde la consola).
