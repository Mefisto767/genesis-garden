#!/usr/bin/env bash
# Тот же набор миграций + сценарных SQL-тестов, что и run_local.sh, но через
# обычное TCP-подключение psql (PGHOST/PGPORT/PGUSER/PGPASSWORD) вместо
# `su postgres` — так CI (GitHub Actions с postgres:16 service-контейнером)
# не нуждается в sudo/локальном systemd-кластере, только в переменных
# окружения psql. run_local.sh НЕ трогаем — он остаётся рабочим способом
# прогона в этой сессии-песочнице (где TCP до Postgres нет, только сокет
# под пользователем postgres).
#
# Использование (см. .github/workflows/ci.yml):
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres \
#     bash supabase/tests/run_ci.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../migrations" && pwd)"
DB_NAME="genesis_garden_test"

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGUSER PGPASSWORD

run_sql() {
  psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$1"
}

echo "== (пере)создаём тестовую БД $DB_NAME =="
psql -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
psql -d postgres -c "CREATE DATABASE $DB_NAME;"

echo "== применяем shim + миграции + каталог + сценарные тесты =="
run_sql "$SCRIPT_DIR/00_local_auth_shim_pre.sql"
run_sql "$MIGRATIONS_DIR/20260827120000_init_schema.sql"
run_sql "$SCRIPT_DIR/01_local_grants_mid.sql"
run_sql "$MIGRATIONS_DIR/20260827120100_rls.sql"
run_sql "$MIGRATIONS_DIR/20260827120200_functions.sql"
run_sql "$MIGRATIONS_DIR/20260827120300_catalog_data.sql"
run_sql "$MIGRATIONS_DIR/20260827130000_migrate_local_progress.sql"
run_sql "$MIGRATIONS_DIR/20260827140000_social_stage6.sql"
run_sql "$MIGRATIONS_DIR/20260827150000_payments_stage7.sql"
run_sql "$SCRIPT_DIR/02_scenario_tests.sql"
run_sql "$SCRIPT_DIR/03_migration_tests.sql"
run_sql "$SCRIPT_DIR/04_social_tests.sql"
run_sql "$SCRIPT_DIR/05_payments_tests.sql"

echo "== ГОТОВО: все SQL-миграции применились и сценарные тесты прошли =="
