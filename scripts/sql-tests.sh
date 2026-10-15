#!/usr/bin/env bash
# SQL ტესტები: თითო ფაილი სუფთა ბაზაზე — shim (Supabase-ის როლები/სქემები) + schema.sql ორჯერ (განმეორებით გაშვებაც მოწმდება) + ტესტი.
# გაშვება: PGHOST=localhost PGUSER=postgres PGPASSWORD=… bash scripts/sql-tests.sh
set -uo pipefail
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
cd "$(dirname "$0")/.."
fail=0
for f in supabase/tests/flows*.sql; do
  db="ezo_test_$(basename "$f" .sql)"
  psql -q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null || { echo "ბაზა ვერ შეიქმნა"; exit 1; }
  if ! err=$(psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/tests/shim.sql -f supabase/schema.sql -f supabase/schema.sql 2>&1 >/dev/null); then
    echo "FAIL schema ($f)"; echo "$err" | grep -v NOTICE | tail -20; fail=1; continue
  fi
  if out=$(psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" 2>&1); then
    echo "ok   $f "
  else
    echo "FAIL $f"; echo "$out" | tail -25; fail=1
  fi
  psql -q -d postgres -c "drop database if exists $db" >/dev/null
done
exit $fail
