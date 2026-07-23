#!/usr/bin/env bash
# Safe-loader contract + places compatibility tests.
# No production apply. Production dry-run only (sample_limit).
#
# Usage:
#   ./tests/safe_loader_contract_tests.sh [--env-file path]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
# shellcheck source=../lib/safe_loader_contract.sh
source "${SCRIPT_DIR}/lib/safe_loader_contract.sh"

ENV_FILE="${1:-}"
if [[ "${1:-}" == "--env-file" ]]; then
  ENV_FILE="${2:-}"
fi
if [[ -z "${ENV_FILE}" ]]; then
  ENV_FILE="${SCRIPT_DIR}/../local-osm/imports/yangon_city_production_pilot_2026_07_23.env"
fi
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

PASS=0
FAIL=0
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

ok() {
  PASS=$((PASS + 1))
  echo "PASS: $*"
}
bad() {
  FAIL=$((FAIL + 1))
  echo "FAIL: $*" >&2
}

expect_fail() {
  local label="$1"
  shift
  set +e
  "$@" >"${TMP_DIR}/out.txt" 2>"${TMP_DIR}/err.txt"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    ok "${label}"
  else
    bad "${label} (expected non-zero exit)"
    cat "${TMP_DIR}/out.txt" "${TMP_DIR}/err.txt" >&2 || true
  fi
}

expect_pass() {
  local label="$1"
  shift
  set +e
  "$@" >"${TMP_DIR}/out.txt" 2>"${TMP_DIR}/err.txt"
  local rc=$?
  set -e
  if [[ "${rc}" -eq 0 ]]; then
    ok "${label}"
  else
    bad "${label}"
    cat "${TMP_DIR}/out.txt" "${TMP_DIR}/err.txt" >&2 || true
  fi
}

echo "===== safe_loader_contract_tests ====="
echo "env_file=${ENV_FILE}"
echo ""

# ---------------------------------------------------------------------------
# Gate tests (no loader SQL)
# ---------------------------------------------------------------------------

echo "--- gate: missing target ---"
expect_fail "missing --target" \
  bash "${SCRIPT_DIR}/run_places_safe_loader.sh" --batch-code places_x --dry-run

echo "--- gate: wrong production confirmation ---"
(
  # shellcheck disable=SC2030
  export LOCAL_DATABASE_URL SUPABASE_DATABASE_URL SUPABASE_WRITE_DATABASE_URL
  expect_fail "wrong confirmation" \
    bash "${SCRIPT_DIR}/run_places_safe_loader.sh" \
      --target production \
      --batch-code places_yangon_essential_safe_2026_07_23 \
      --apply \
      --confirmation "APPLY places WRONG"
)

echo "--- gate: local/production URL ambiguity ---"
(
  AMBIG="${LOCAL_DATABASE_URL}"
  export LOCAL_DATABASE_URL="${AMBIG}"
  export SUPABASE_DATABASE_URL="${AMBIG}"
  export SUPABASE_WRITE_DATABASE_URL="${AMBIG}"
  expect_fail "identical local/production fingerprints" \
    bash -c '
      source "'"${SCRIPT_DIR}"'/lib/safe_loader_contract.sh"
      safe_loader_refuse_ambiguous_urls
    '
)

echo "--- gate: production identity missing project ref ---"
(
  export SUPABASE_DATABASE_URL="postgresql://postgres:x@db.example.com:5432/postgres"
  unset SUPABASE_WRITE_DATABASE_URL || true
  expect_fail "unverifiable production URL" \
    bash -c '
      source "'"${SCRIPT_DIR}"'/lib/safe_loader_contract.sh"
      safe_loader_resolve_target production
      safe_loader_verify_production_identity "${SAFE_LOADER_DATABASE_URL}"
    '
)

# ---------------------------------------------------------------------------
# Ensure local has import_work for dry-run / rollback suite
# ---------------------------------------------------------------------------

echo "--- local: ensure import_work schema ---"
if ! PAGER=cat psql "${LOCAL_DATABASE_URL}" -Atc "SELECT to_regclass('import_work.place_rows')" | grep -q place_rows; then
  echo "bootstrapping import_work on LOCAL (no Supabase API roles)..."
  PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -f "${SCRIPT_DIR}/tests/bootstrap_import_work_local.sql"
fi
# Identity helpers (CREATE OR REPLACE — safe on local)
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -f "${REPO_ROOT}/infrastructure/database/migrations/supabase/137_pipeline_osm_identity_helpers.sql"
ok "local import_work available"

echo "--- local: places contract preflight dry-run (import_work identity) ---"
# Local geo_core lacks production core.core_places columns (external_id/source_refs),
# so places SQL body cannot run locally. Contract still requires explicit --target local.
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $$
DECLARE
  v_batch_id bigint;
BEGIN
  DELETE FROM import_work.place_rows r
  USING import_work.import_batches b
  WHERE r.import_batch_id = b.id AND b.batch_code = 'places_contract_local_dryrun';
  DELETE FROM import_work.import_batches WHERE batch_code = 'places_contract_local_dryrun';

  INSERT INTO import_work.import_batches (
    batch_code, entity_family, source_snapshot_id, source_snapshot_version,
    status, expected_row_count, loaded_row_count, validation_status
  ) VALUES (
    'places_contract_local_dryrun', 'places', 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
    'loaded', 1, 1, 'passed'
  ) RETURNING id INTO v_batch_id;
END $$;
COMMIT;
SQL

expect_pass "local dry-run preflight via runner" \
  bash "${SCRIPT_DIR}/run_places_safe_loader.sh" \
    --target local \
    --batch-code places_contract_local_dryrun \
    --dry-run \
    --preflight-only

echo "--- production: places_safe_loader_tests (identical rerun + failure rollback, txn rolled back) ---"
expect_pass "production simulated failure rollback + identical rerun" \
  bash -c "PAGER=cat psql \"${SUPABASE_DATABASE_URL}\" -v ON_ERROR_STOP=1 -f \"${SCRIPT_DIR}/places_safe_loader_tests.sql\""

echo "--- production: dry-run only (sample_limit=3, no apply) ---"
expect_pass "production dry-run sample" \
  bash "${SCRIPT_DIR}/run_places_safe_loader.sh" \
    --target production \
    --batch-code places_yangon_essential_safe_2026_07_23 \
    --dry-run \
    --sample-limit 3

if grep -Eq 'places_loader|DRY RUN' "${TMP_DIR}/out.txt" "${TMP_DIR}/err.txt"; then
  ok "production dry-run emitted loader markers"
else
  bad "production dry-run missing progress markers"
fi

echo "--- production: refuse apply without confirmation ---"
expect_fail "production apply missing confirmation" \
  bash "${SCRIPT_DIR}/run_places_safe_loader.sh" \
    --target production \
    --batch-code places_yangon_essential_safe_2026_07_23 \
    --apply

echo ""
echo "===== summary PASS=${PASS} FAIL=${FAIL} ====="
if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
echo "safe_loader_contract_tests: ALL CHECKS PASSED"
