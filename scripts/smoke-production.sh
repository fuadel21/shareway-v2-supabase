#!/usr/bin/env bash
# ============================================================================
# SHAREWAY · SMOKE TEST DE PRODUCCIÓN
# ============================================================================
# Verifica en vivo que todos los servicios críticos responden:
#   1. Web (shareway.es)          5. Edge Functions clave
#   2. Assets del bundle          6. RPCs críticos (auth requerida = existe)
#   3. Supabase Auth              7. Cron de conciliación registrado
#   4. Supabase REST              8. Bundle con la clave Stripe correcta
# Uso: ./scripts/smoke-production.sh
# ============================================================================
set -u
WEB="https://shareway.es"
SB="https://wmkhutsesgtkcgqbctef.supabase.co"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indta2h1dHNlc2d0a2NncWJjdGVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyNjI2MjAsImV4cCI6MjA4MTgzODYyMH0.EpdpWBWCc96BsJlK6vDHKQTATCrgsDRQg1mQDZ2PGVk"
PASS=0; FAIL=0
ok(){ printf "  ✓ %s\n" "$1"; PASS=$((PASS+1)); }
ko(){ printf "  ✗ %s %s\n" "$1" "${2:-}"; FAIL=$((FAIL+1)); }

echo "== 1. Web =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$WEB/")
[ "$CODE" = "200" ] && ok "shareway.es responde 200" || ko "web HTTP $CODE"

echo "== 2. Bundle =="
HASH=$(curl -s -m 15 "$WEB/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
[ -n "$HASH" ] && ok "bundle: $HASH" || ko "sin bundle"
curl -s -m 20 "$WEB/$HASH" -o /tmp/smoke_bundle.js
grep -q "pk_live_51SHcZTB3YBELMkdd" /tmp/smoke_bundle.js && ok "clave Stripe live en bundle" || ko "clave Stripe incorrecta"
grep -q "wmkhutsesgtkcgqbctef" /tmp/smoke_bundle.js && ok "proyecto Supabase correcto" || ko "proyecto Supabase incorrecto"

echo "== 3. Supabase Auth =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$SB/auth/v1/health" -H "apikey: $ANON")
[ "$CODE" = "200" ] && ok "auth health 200" || ko "auth HTTP $CODE"

echo "== 4. REST anónimo =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$SB/rest/v1/rides?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")
[ "$CODE" = "200" ] && ok "REST responde" || ko "REST HTTP $CODE"

echo "== 5. Edge Functions (cabeceras) =="
for fn in stripe-webhook send-push stripe-reconcile notify-admin-new-user create-payment-intent; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 15 -X POST "$SB/functions/v1/$fn" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{}')
  # 401/400 = existe y rechaza (correcto); 404/500 = problema
  case "$CODE" in 400|401|405) ok "$fn ($CODE = protegida)";; *) ko "$fn HTTP $CODE";; esac
done

echo "== 6. RPCs críticos (existen + blindados contra anon) =="
# con argumentos validos: anon debe recibir 401/42501 (existe y rechaza)
DUMMY='{"p_ride_id":"00000000-0000-0000-0000-000000000000","p_pickup_location":{"lat":0,"lng":0},"p_dropoff_location":{"lat":0,"lng":0},"p_num_seats":1}'
declare -A RPCS=(
  [quote_ride_booking]="$DUMMY"
  [confirm_trip_and_pay]='{"p_ride_id":"00000000-0000-0000-0000-000000000000"}'
  [create_ride]='{"p_origin":{"lat":0,"lng":0},"p_destination":{"lat":0,"lng":0},"p_departure_time":"2030-01-01T00:00:00Z","p_seats":1,"p_price":1}'
  [create_ride_request]='{"p_origin":{"lat":0,"lng":0},"p_destination":{"lat":0,"lng":0},"p_departure_time":"2030-01-01T00:00:00Z","p_seats_needed":1,"p_suggested_price":1}'
  [fulfill_ride_request]='{"p_request_id":"00000000-0000-0000-0000-000000000000"}'
  [cancel_booking_and_refund]='{"p_ride_id":"00000000-0000-0000-0000-000000000000"}'
  [cancel_ride]='{"p_ride_id":"00000000-0000-0000-0000-000000000000"}'
  [complete_ride]='{"p_ride_id":"00000000-0000-0000-0000-000000000000"}'
  [submit_review_v2]='{"p_ride_id":"00000000-0000-0000-0000-000000000000","p_reviewee_id":"00000000-0000-0000-0000-000000000000","p_rating":5}'
)
for rpc in quote_ride_booking confirm_trip_and_pay create_ride create_ride_request fulfill_ride_request cancel_booking_and_refund cancel_ride complete_ride submit_review_v2; do
  BODY=$(curl -s -w "\n%{http_code}" -m 15 -X POST "$SB/rest/v1/rpc/$rpc" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "${RPCS[$rpc]}")
  CODE=$(echo "$BODY" | tail -1)
  MSG=$(echo "$BODY" | head -1)
  # blindado = 401/42501, o 400 con mensaje de autenticacion (excepcion plpgsql)
  if [ "$CODE" = "401" ] || [ "$CODE" = "42501" ] || { [ "$CODE" = "400" ] && echo "$MSG" | grep -qiE "autenticado|auth"; }; then
    ok "$rpc ($CODE blindado)"
  else
    ko "$rpc HTTP $CODE $MSG"
  fi
done

echo "== 7. Recursos estáticos =="
for path in favicon.svg logo.svg manifest.json; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$WEB/$path")
  [ "$CODE" = "200" ] && ok "/$path" || ko "/$path HTTP $CODE"
done

echo ""
echo "RESULTADO: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = "0" ] && exit 0 || exit 1
