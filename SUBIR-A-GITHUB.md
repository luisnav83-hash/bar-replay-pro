# 📤 Subir Bar Replay Pro a GitHub

Tienes dos caminos. El **A** funciona desde el móvil en 2 minutos; el **B** es el
profesional (desde un ordenador con Git).

---

## 🅰️ Opción rápida (arrastrar y soltar, desde el móvil o el PC)

1. **Descarga** `bar-replay-pro-github.zip` (3,7 MB) del workspace.
2. Entra en **https://github.com/new** y crea un repositorio:
   - **Nombre:** `bar-replay-pro`
   - **Visibilidad:** público (necesario para usar GitHub Pages gratis)
   - **NO** marques "Add a README file" (ya llevamos el nuestro).
3. En el repositorio recién creado pulsa **«uploading an existing file»**
   (o ve a `https://github.com/TU-USUARIO/bar-replay-pro/upload/main`).
4. **Descomprime el ZIP** y arrastra **el contenido de la carpeta
   `bar-replay-app`** (no la carpeta en sí) a la zona de subida.
5. Abajo, escribe un mensaje de commit, por ejemplo
   `Bar Replay Pro: versión inicial`, y pulsa **Commit changes**.

> ⚠️ Ojo: hay que subir **el contenido**, de modo que `index.html` quede en la
> raíz del repositorio (no dentro de otra carpeta). Si se sube la carpeta,
> GitHub Pages cargaría una ruta equivocada.

### 🌐 Activar la web (GitHub Pages) — así la abres desde el móvil

Al subir el proyecto ya viene el flujo `.github/workflows/pages.yml`, que
publica la app automáticamente:

1. Ve a **Settings → Pages**.
2. En *Source* elige **GitHub Actions**.
3. Espera ~1 minuto (pestaña **Actions**, verás «Publicar en GitHub Pages» ✅).

Tu app quedará en:

```
https://TU-USUARIO.github.io/bar-replay-pro/
```

y el archivo único (recomendado para el móvil) en:

```
https://TU-USUARIO.github.io/bar-replay-pro/bar-replay-pro-unico.html
```

Ese enlace se abre con **Chrome o Safari del móvil** y funciona completo, con
las 4.000 velas reales incluidas.

---

## 🅱️ Opción con Git (desde el ordenador)

El ZIP ya incluye un **repositorio con el primer commit hecho** (carpeta
oculta `.git`). Solo tienes que engancharlo a tu cuenta:

```bash
# 1) Crea el repositorio vacío en https://github.com/new (sin README ni .gitignore)

# 2) Descomprime el ZIP y entra en la carpeta
cd bar-replay-app

# 3) Apunta al repositorio que acabas de crear y sube
git remote add origin https://github.com/TU-USUARIO/bar-replay-pro.git
git branch -M main
git push -u origin main
```

Si te pide contraseña, usa un **token personal** (no la contraseña de la
cuenta): GitHub → *Settings → Developer settings → Personal access tokens* →
*Fine-grained tokens* → permisos **Contents: Read and write** sobre ese repo.

Con SSH sería:

```bash
git remote add origin git@github.com:TU-USUARIO/bar-replay-pro.git
git push -u origin main
```

---

## 🧾 Qué se sube (60 archivos · 4,7 MB)

```
bar-replay-app/
├── .github/workflows/pages.yml   ← publicación automática en GitHub Pages
├── index.html                    ← aplicación principal (versión servidor)
├── bar-replay-pro-unico.html     ← TODO en un archivo (647 KB, sin servidor)
├── css/          main · chart · panels · modals · responsive
├── js/           12 módulos comentados en español
├── snapshot/     velas-reales.json (4.000 velas reales de Binance)
├── tools/        build-single.js · snapshot.js · demo-video.js
├── tests/        11 suites · 385 comprobaciones
├── docs/         14 capturas + vídeo de demostración (MP4)
└── README.md     documentación completa
```

**No se sube** el ZIP: `.git`, `node_modules` y las cachés quedan fuera (ya
están en `.gitignore`).

---

## ✅ Comprobado antes de empaquetar

- Repositorio inicializado y **primer commit hecho** con la descripción del proyecto.
- **60 archivos** versionados, ninguno de basura.
- ZIP con **integridad verificada** (sin corrupción).
- Flujo de GitHub Pages listo: no hay que configurar nada más que la fuente.
