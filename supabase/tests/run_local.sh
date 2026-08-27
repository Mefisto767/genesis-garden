#!/usr/bin/env bash
# Прогоняет все SQL-миграции + RLS/RPC/идемпотентность сценарные тесты на
# локальной PostgreSQL БЕЗ полного Supabase-стека (в CI/песочнице без Docker
# supabase CLI поднять нельзя — см. docs/TESTING.md). Имитирует ровно то, что
# нужно от Supabase (схема auth, роли anon/authenticated/service_role) через
# supabase/tests/00_local_auth_shim_pre.sql — этот шим НЕ применяется на
# реальном проекте, только здесь.
#
# Использование: sudo bash supabase/tests/run_local.sh
# Требует запущенный локальный кластер PostgreSQL (служба postgresql) и
# доступ к psql под пользователем postgres.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../migrations" && pwd)"
DB_NAME="genesis_garden_test"
WORKDIR="$(mktemp -d)"

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

cp "$SCRIPT_DIR"/*.sql "$MIGRATIONS_DIR"/*.sql "$WORKDIR"/
chmod -R a+rX "$WORKDIR"

run_sql() {
  su postgres -c "psql -v ON_ERROR_STOP=1 -d $DB_NAME -f $WORKDIR/$1"
}

echo "== (пере)создаём тестовую БД $DB_NAME =="
su postgres -c "psql -c 'DROP DATABASE IF EXISTS $DB_NAME;'"
su postgres -c "psql -c 'CREATE DATABASE $DB_NAME;'"

echo "== применяем shim + миграции + каталог + сценарные тесты =="
run_sql 00_local_auth_shim_pre.sql
run_sql 20260827120000_init_schema.sql
run_sql 01_local_grants_mid.sql
run_sql 20260827120100_rls.sql
run_sql 20260827120200_functions.sql
run_sql 20260827120300_catalog_data.sql
run_sql 02_scenario_tests.sql

echo "== ГОТОВО: все SQL-миграции применились и сценарные тесты прошли =="
