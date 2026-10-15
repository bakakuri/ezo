#!/usr/bin/env bash
# ლოკალური Supabase (Auth + PostgREST + Storage + game ფუნქცია) და მასზე ორი შემოწმება:
#   1) API-ს შემოწმება: აპის და Edge Function-ების ყველა მოთხოვნა რეალურ PostgREST-ზე (scripts/api-check/check.mjs)
#   2) კონტრაქტის ტესტი: აპის api.supabase.js სამი მომხმარებლით — რეგისტრაციიდან ანგარიშის წაშლამდე (contract.mjs)
#   3) წერილები: ჩვენი ქართული შაბლონები ნამდვილ Auth-ში, ლოკალურ SMTP-ზე (emails.mjs)
# საჭიროა: Postgres (superuser, PG* ცვლადები), psql, node 20+, curl, tar/xz და npm install.
# გაშვება: PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/real-stack/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

W="${REAL_STACK_DIR:-$PWD/.real-stack}"
AUTH_VERSION=v2.197.0
PGRST_VERSION=v14.1
DB="${REAL_STACK_DB:-ezo_real_ci}"
GATEWAY_PORT="${GATEWAY_PORT:-54321}"
PGRST_PORT="${PGRST_PORT:-3000}"
AUTH_PORT="${AUTH_PORT:-9999}"
export JWT_SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
export PGOPTIONS="-c client_min_messages=warning"
PGH="${PGHOST:-localhost}"
PGP="${PGPORT:-5432}"

mkdir -p "$W/bin"
rm -rf "$W/store" && mkdir -p "$W/store"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
wait_for() { # $1 = URL, $2 = ჟურნალი
  for _ in $(seq 1 90); do curl -s -o /dev/null --max-time 2 "$1" && return 0; sleep 1; done
  echo "ვერ ჩაირთო: $1"; tail -40 "$2"; exit 1
}

echo "== ბინარები"
if [ ! -x "$W/bin/postgrest" ]; then
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-linux-static-x86-64.tar.xz" | tar -xJ -C "$W/bin"
fi
if [ ! -x "$W/auth/auth" ]; then
  mkdir -p "$W/auth"
  curl -fsSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar -xz -C "$W/auth"
fi

echo "== ბაზა $DB"
psql -q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f scripts/real-stack/setup.sql -f scripts/real-stack/prepare-db.sql >/dev/null
export PGDATABASE="$DB"

echo "== Auth $AUTH_VERSION (მიგრაციებით)"
env -i PATH="$PATH" \
  GOTRUE_API_HOST=127.0.0.1 PORT="$AUTH_PORT" \
  API_EXTERNAL_URL="http://localhost:$GATEWAY_PORT/auth/v1" \
  GOTRUE_DB_DRIVER=postgres GOTRUE_DB_NAMESPACE=auth \
  DATABASE_URL="postgres://supabase_auth_admin:authadmin@$PGH:$PGP/$DB?search_path=auth&sslmode=disable" \
  GOTRUE_DB_MIGRATIONS_PATH="$W/auth/migrations" \
  GOTRUE_SITE_URL=http://localhost:5173 GOTRUE_URI_ALLOW_LIST='http://localhost:5173/**' \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true \
  GOTRUE_MFA_TOTP_ENROLL_ENABLED=true GOTRUE_MFA_TOTP_VERIFY_ENABLED=true \
  GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_SMTP_HOST=localhost GOTRUE_SMTP_PORT=2500 GOTRUE_SMTP_ADMIN_EMAIL=admin@ezo.test \
  GOTRUE_LOG_LEVEL=warn \
  "$W/auth/auth" >"$W/auth.log" 2>&1 &
pids+=($!)
wait_for "http://localhost:$AUTH_PORT/health" "$W/auth.log"

echo "== schema.sql"
psql -q -v ON_ERROR_STOP=1 -f supabase/schema.sql >/dev/null

echo "== PostgREST $PGRST_VERSION"
PGRST_DB_URI="postgres://authenticator:authenticator@$PGH:$PGP/$DB" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT="$PGRST_PORT" PGRST_LOG_LEVEL=error \
  "$W/bin/postgrest" >"$W/postgrest.log" 2>&1 &
pids+=($!)
wait_for "http://localhost:$PGRST_PORT/" "$W/postgrest.log"

echo "== აპის API და game ფუნქცია Node-ისთვის"
SUPABASE_URL="http://localhost:$GATEWAY_PORT" node scripts/real-stack/build.mjs "$W"
# shellcheck disable=SC1091
source "$W/keys.env"

echo "== gateway :$GATEWAY_PORT"
GATEWAY_PORT="$GATEWAY_PORT" PGRST_PORT="$PGRST_PORT" AUTH_PORT="$AUTH_PORT" STORE_DIR="$W/store" \
  GAME_FN="$W/game-fn.mjs" SERVICE_KEY="$SERVICE_KEY" node scripts/real-stack/gateway.mjs >"$W/gateway.log" 2>&1 &
pids+=($!)
wait_for "http://localhost:$GATEWAY_PORT/" "$W/gateway.log"

status=0
echo "== API-ს შემოწმება"
PGRST_URL="http://localhost:$PGRST_PORT" node scripts/api-check/check.mjs \
  --app src/lib/api.supabase.js --server supabase/functions/game/index.ts supabase/functions/push/index.ts || status=1

echo "== კონტრაქტის ტესტი"
SUPABASE_URL="http://localhost:$GATEWAY_PORT" node scripts/real-stack/contract.mjs "$W" || status=1

echo "== ქართული წერილები (დადასტურება, აღდგენა, 2FA, ელფოსტის შეცვლა…)"
SERVICE_KEY="$SERVICE_KEY" node scripts/real-stack/emails.mjs "$W" || status=1

exit $status
