#!/usr/bin/env bash
# =========================================================================
# tools/subir-a-github.sh — Sube este proyecto a GitHub y publica la app
# en GitHub Pages, en un solo paso.
#
# USO (desde la carpeta del proyecto):
#
#   GITHUB_TOKEN=ghp_xxxxxxxx ./tools/subir-a-github.sh [nombre-del-repo]
#
#   · GITHUB_TOKEN: token con permiso para escribir en el repositorio.
#       - Token clásico con el permiso «repo»: crea el repositorio solo.
#       - Token «fine-grained» con «Contents: Read and write»: hay que crear
#         antes el repositorio vacío a mano en https://github.com/new
#   · nombre-del-repo (opcional): por defecto «bar-replay-pro».
#
# QUÉ HACE:
#   1. Comprueba el token y saca tu usuario
#   2. Crea el repositorio si no existe
#   3. Hace commit de lo que haya pendiente
#   4. Sube la rama main
#   5. Intenta activar GitHub Pages (y te dice qué hacer si no puede)
#
# ⚠️ El token NO se guarda en ningún archivo: solo se usa en memoria para el
#    push. Revócalo en GitHub cuando termines si lo generaste para esto.
# ========================================================================
set -euo pipefail

TOKEN="${GITHUB_TOKEN:-}"
REPO="${1:-bar-replay-pro}"

if [ -z "$TOKEN" ]; then
  echo "❌ Falta el token. Uso:"
  echo "   GITHUB_TOKEN=tu_token ./tools/subir-a-github.sh [nombre-repo]"
  exit 1
fi

API="https://api.github.com"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")
say() { printf '%s\n' "$*"; }

# ── 1) Usuario ────────────────────────────────────────────────────────────
USUARIO=$(curl -s "${AUTH[@]}" "$API/user" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);if(!j.login){console.error('Token inválido o sin permisos');process.exit(1)}console.log(j.login)}catch(e){console.error('Token inválido');process.exit(1)}})")
say "· Usuario de GitHub: $USUARIO"

# ── 2) Crear el repositorio si no existe ──────────────────────────────────
CODIGO=$(curl -s -o /tmp/gh_repo.json -w '%{http_code}' "${AUTH[@]}" "$API/repos/$USUARIO/$REPO")
if [ "$CODIGO" = "200" ]; then
  say "· El repositorio $USUARIO/$REPO ya existe: se actualizará."
else
  say "· Creando el repositorio $REPO…"
  CREA=$(curl -s -o /tmp/gh_new.json -w '%{http_code}' -X POST "${AUTH[@]}" \
    -d "{\"name\":\"$REPO\",\"description\":\"Bar Replay Pro — backtesting vela a vela con datos reales de Binance\",\"private\":false}" \
    "$API/user/repos")
  if [ "$CREA" = "201" ]; then
    say "  ✓ Repositorio creado (público)"
  else
    say "  ⚠ No se pudo crear automáticamente (código $CREA)."
    say "    Crea el repositorio vacío en https://github.com/new y vuelve a ejecutar."
    exit 1
  fi
fi

# ── 3) Commit de lo pendiente ─────────────────────────────────────────────
cd "$(dirname "$0")/.."
git config user.email >/dev/null 2>&1 || git config user.email "dev@bar-replay.local"
git config user.name  >/dev/null 2>&1 || git config user.name  "Bar Replay Pro"
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  git -c commit.gpgsign=false commit -q -m "Actualización de Bar Replay Pro" || true
  say "· Commit de los cambios pendientes hecho"
fi
git branch -M main 2>/dev/null || true

# ── 4) Subir ──────────────────────────────────────────────────────────────
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:$TOKEN@github.com/$USUARIO/$REPO.git"
say "· Subiendo los archivos a GitHub…"
if git push -u origin main --quiet 2>/tmp/gh_push.log; then
  say "  ✓ Subido: https://github.com/$USUARIO/$REPO"
else
  say "  ✗ El push falló:"
  sed 's/x-access-token:[^@]*@/x-access-token:***@/g' /tmp/gh_push.log | sed 's/^/     /'
  exit 1
fi

# ── 5) Activar GitHub Pages ───────────────────────────────────────────────
PAGES=$(curl -s -o /tmp/gh_pages.json -w '%{http_code}' -X POST "${AUTH[@]}" \
  -d '{"build_type":"workflow"}' "$API/repos/$USUARIO/$REPO/pages")
if [ "$PAGES" = "201" ] || [ "$PAGES" = "204" ]; then
  say "· ✓ GitHub Pages activado (compilación automática)"
elif [ "$PAGES" = "409" ]; then
  say "· GitHub Pages ya estaba activado"
else
  say "· ⚠ Activa GitHub Pages a mano: Settings → Pages → Source: «GitHub Actions»"
fi

say ""
say "🎉 Listo. En 1-2 minutos la app estará en:"
say "   Repositorio: https://github.com/$USUARIO/$REPO"
say "   App (navegador normal): https://$USUARIO.github.io/$REPO/"
say "   Archivo único (ideal para móvil): https://$USUARIO.github.io/$REPO/bar-replay-pro-unico.html"
say ""
say "⚠️ Recuerda revocar el token cuando termines: https://github.com/settings/tokens"
