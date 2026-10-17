#!/usr/bin/env bash
# Conecta este repo con los servicios remotos de ShareWay (Supabase, GitHub, Vercel, Stripe).
# Ejecutar en TU máquina (no en el sandbox del agente, que no tiene salida a estos hosts).
#
#   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_DB_PASSWORD=... ./scripts/connect-remotes.sh [check|secrets|functions|migrations|all]
#
# Los secretos de servidor se leen de un fichero local NO versionado (por defecto .env.secrets):
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
#   VAPID_SUBJECT, PUSH_WEBHOOK_SECRET, ALLOWED_ORIGINS, RESEND_API_KEY, ADMIN_EMAIL
set -euo pipefail
cd "$(dirname "$0")/.."

STEP="${1:-check}"
REF="${SUPABASE_PROJECT_REF:-$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)}"
SECRETS_FILE="${SECRETS_FILE:-.env.secrets}"
GH_REPO="${GH_REPO:-fuadel21/shareway-v2-supabase}"
SB="npx --yes supabase@latest"
ok(){ printf '  \033[32mOK\033[0m   %s\n' "$*"; }
ko(){ printf '  \033[31mFALLA\033[0m %s\n' "$*"; FAILED=1; }
FAILED=0

reach() { curl -s -o /dev/null -m 10 "$2" && ok "$1 alcanzable" || ko "$1 NO alcanzable ($2)"; }

check() {
  echo "== Red"
  reach "Supabase API"  https://api.supabase.com
  reach "Supabase proyecto" "https://$REF.supabase.co/auth/v1/health"
  reach "Stripe API"    https://api.stripe.com
  reach "Vercel API"    https://api.vercel.com
  echo "== Credenciales"
  [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && ok "SUPABASE_ACCESS_TOKEN" || ko "falta SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)"
  [ -n "${SUPABASE_DB_PASSWORD:-}" ]  && ok "SUPABASE_DB_PASSWORD"  || ko "falta SUPABASE_DB_PASSWORD (Project Settings > Database)"
  [ -f "$SECRETS_FILE" ] && ok "$SECRETS_FILE" || ko "falta $SECRETS_FILE (secretos de Edge Functions)"
  echo "== GitHub Actions secrets ($GH_REPO)"
  if command -v gh >/dev/null && names=$(gh secret list -R "$GH_REPO" --json name -q '.[].name' 2>/dev/null); then
    for s in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD; do
      grep -qx "$s" <<<"$names" && ok "$s" || ko "falta secret $s  ->  gh secret set $s -R $GH_REPO"
    done
  else
    ko "no puedo listar secrets (gh sin sesión o sin permisos)"
  fi
  echo "== Proyecto Supabase"
  if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    $SB functions list --project-ref "$REF" >/dev/null 2>&1 && ok "token válido para $REF" || ko "el token no da acceso a $REF"
  fi
}

secrets() {
  [ -f "$SECRETS_FILE" ] || { echo "Falta $SECRETS_FILE"; exit 1; }
  echo "== Subiendo secretos de Edge Functions a $REF (valores no se imprimen)"
  $SB secrets set --project-ref "$REF" --env-file "$SECRETS_FILE"
}

functions() {
  echo "== Desplegando TODAS las Edge Functions en $REF"
  $SB functions deploy --project-ref "$REF" --use-api
}

migrations() {
  echo "== Aplicando SECURITY_FIXES_V1 (critico: exploits de wallet y precios)"
  $SB db push --include-all 2>/dev/null || true
  psql "$SUPABASE_DB_URL" -f supabase/SECURITY_FIXES_V1.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/SECURITY_FIXES_V1.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_REQUEST_FLOW (flujo solicitar/ofrecer plaza)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_REQUEST_FLOW.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_REQUEST_FLOW.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_BOOKING_QUOTE_V2 (recalculo de precio por km en reservas)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_BOOKING_QUOTE_V2.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_BOOKING_QUOTE_V2.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_BOOKING_CONFIRM_V2 (cobro por km al confirmar con cartera)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_BOOKING_CONFIRM_V2.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_BOOKING_CONFIRM_V2.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_WALLET_REFUND (reversión de saldo al reembolsar recargas)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_WALLET_REFUND.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_WALLET_REFUND.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_MISSING_RPCS (RPCs que faltaban: busqueda, gestion pasajeros, valoraciones, radar, seguridad, mapa)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_MISSING_RPCS.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_MISSING_RPCS.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_RADAR_TYPES (tipos bigint del radar y create_notification)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_RADAR_TYPES.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_RADAR_TYPES.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_RADAR_PUSH (cola de push del radar)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_RADAR_PUSH.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_RADAR_PUSH.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_DROPOFF_SEATS (dropoff multi-plaza)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_DROPOFF_SEATS.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_DROPOFF_SEATS.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_COMPLETE_RIDE_DOUBLE_PAY (sin doble cobro dropoff+finalize)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_COMPLETE_RIDE_DOUBLE_PAY.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_COMPLETE_RIDE_DOUBLE_PAY.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_STRIPE_RECONCILE (cron de conciliación con Stripe)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_STRIPE_RECONCILE.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_STRIPE_RECONCILE.sql en el SQL Editor si psql no esta disponible"

  echo "== Aplicando FIX_STRIPE_WEBHOOK_CORE (capa SQL del webhook de Stripe)"
  psql "$SUPABASE_DB_URL" -f supabase/FIX_STRIPE_WEBHOOK_CORE.sql 2>/dev/null \
    || echo "  NOTA: ejecuta supabase/FIX_STRIPE_WEBHOOK_CORE.sql en el SQL Editor si psql no esta disponible"

  echo "== Plan de migraciones (dry-run)"
  $SB link --project-ref "$REF" --password "${SUPABASE_DB_PASSWORD:?}"
  $SB db push --dry-run --password "$SUPABASE_DB_PASSWORD"
  read -r -p "¿Aplicar? [s/N] " a; [ "$a" = s ] && $SB db push --password "$SUPABASE_DB_PASSWORD" --yes
}

case "$STEP" in
  check) check ;;
  secrets) secrets ;;
  functions) functions ;;
  migrations) migrations ;;
  all) check; [ "$FAILED" = 0 ] || exit 1; secrets; functions; migrations ;;
  *) echo "uso: $0 [check|secrets|functions|migrations|all]"; exit 2 ;;
esac
exit "$FAILED"
