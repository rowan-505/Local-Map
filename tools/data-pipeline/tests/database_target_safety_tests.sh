#!/usr/bin/env bash
# Automated tests for database target resolution (no live DB required for gate tests).
#
# Usage:
#   ./tools/data-pipeline/tests/database_target_safety_tests.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${SCRIPT_DIR}/../lib/database_target_safety.sh"
# shellcheck source=../lib/database_target_safety.sh
source "${LIB}"

PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

ok() { PASS=$((PASS + 1)); echo "PASS: $*"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $*" >&2; }

# Run body in a clean child with explicit env assignments (NAME=value ...).
# Unset list via EXPECT_UNSET (space-separated names).
run_case() {
  local label="$1"
  local expect_rc="$2"
  shift 2
  local unset_block=""
  local name
  for name in ${EXPECT_UNSET:-}; do
    unset_block+="unset ${name}; "
  done
  set +e
  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    DB_TARGET_PRODUCTION_PROJECT_REF="${DB_TARGET_PRODUCTION_PROJECT_REF:-locghyuranqaqsnbxflc}" \
    "$@" \
    bash -c "set -euo pipefail; ${unset_block}source \"${LIB}\"; ${EXPECT_BODY}" \
    >"${TMP}/out" 2>"${TMP}/err"
  local rc=$?
  set -e
  if [[ ${rc} -eq "${expect_rc}" ]]; then
    ok "${label}"
  else
    bad "${label} (rc=${rc} expected ${expect_rc})"
    cat "${TMP}/out" "${TMP}/err" >&2
  fi
  EXPECT_UNSET=""
}

echo "===== database_target_safety_tests ====="

echo "--- refuse missing target ---"
EXPECT_BODY='db_target_resolve ""'
run_case "missing target" 1

echo "--- refuse DATABASE_URL as sole write source ---"
EXPECT_BODY='db_target_resolve production write'
run_case "DATABASE_URL alone refused" 1 \
  DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

echo "--- DATABASE_URL + legacy SUPABASE_DATABASE_URL still ok ---"
EXPECT_BODY='db_target_resolve production write; test "${DB_TARGET_LABEL}" = "production-write (legacy SUPABASE_DATABASE_URL)"'
run_case "DATABASE_URL ignored when legacy set" 0 \
  DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  SUPABASE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  LOCAL_DATABASE_URL="postgresql://postgres:x@localhost:5433/geo_core"

echo "--- prefer SUPABASE_WRITE_DATABASE_URL ---"
EXPECT_BODY='db_target_resolve production write; test "${DB_TARGET_LABEL}" = "production-write (SUPABASE_WRITE_DATABASE_URL)"'
run_case "write resolves WRITE url" 0 \
  SUPABASE_WRITE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  LOCAL_DATABASE_URL="postgresql://postgres:x@localhost:5433/geo_core"

echo "--- legacy SUPABASE_DATABASE_URL write with warning ---"
EXPECT_BODY='db_target_resolve production write; test "${DB_TARGET_LABEL}" = "production-write (legacy SUPABASE_DATABASE_URL)"'
run_case "legacy SUPABASE_DATABASE_URL accepted" 0 \
  SUPABASE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  LOCAL_DATABASE_URL="postgresql://postgres:x@localhost:5433/geo_core"

echo "--- read prefers SUPABASE_READ ---"
EXPECT_BODY='db_target_resolve production read; test "${DB_TARGET_LABEL}" = "production-read (SUPABASE_READ_DATABASE_URL)"'
run_case "read uses READ url" 0 \
  SUPABASE_READ_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  SUPABASE_WRITE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:y@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

echo "--- refuse read==write without override ---"
EXPECT_BODY='db_target_resolve production write'
run_case "identical read/write refused" 1 \
  SUPABASE_READ_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws.example:5432/postgres" \
  SUPABASE_WRITE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws.example:5432/postgres"

echo "--- refuse wrong project ref ---"
EXPECT_BODY='db_target_resolve production write; db_target_verify_production_identity "${DB_TARGET_DATABASE_URL}"'
run_case "wrong project ref" 1 \
  SUPABASE_WRITE_DATABASE_URL="postgresql://postgres.wrongproject:x@aws.example:5432/postgres" \
  LOCAL_DATABASE_URL="postgresql://postgres:x@localhost:5433/geo_core"

echo "--- accept expected project ref ---"
EXPECT_BODY='db_target_resolve production write; db_target_verify_production_identity "${DB_TARGET_DATABASE_URL}" >/dev/null'
run_case "expected project ref" 0 \
  SUPABASE_WRITE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  LOCAL_DATABASE_URL="postgresql://postgres:x@localhost:5433/geo_core"

echo "--- refuse ambiguous local==production ---"
U="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
EXPECT_BODY='db_target_refuse_ambiguous_local_vs_production'
run_case "ambiguous fingerprints" 1 \
  LOCAL_DATABASE_URL="$U" \
  SUPABASE_WRITE_DATABASE_URL="$U"

echo "--- production apply confirmation ---"
EXPECT_BODY='db_target_resolve production write; db_target_require_write_gates production apply "APPLY places 11" ""'
run_case "missing confirmation" 1 \
  SUPABASE_WRITE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  LOCAL_DATABASE_URL="postgresql://postgres:x@localhost:5433/geo_core"

EXPECT_BODY='db_target_resolve production write; db_target_require_write_gates production apply "APPLY places 11" "APPLY places 11"'
run_case "correct confirmation" 0 \
  SUPABASE_WRITE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  LOCAL_DATABASE_URL="postgresql://postgres:x@localhost:5433/geo_core"

echo "--- sample scripts refuse production ---"
EXPECT_BODY='DB_TARGET=production; db_target_refuse_production_for_sample "yangon sample"'
run_case "sample refuse production" 1

echo "--- mask credentials ---"
masked="$(db_target_mask_url 'postgresql://postgres.locghyuranqaqsnbxflc:SECRET@host:5432/postgres')"
if [[ "${masked}" == *SECRET* ]]; then
  bad "password leaked in mask: ${masked}"
else
  ok "mask hides password (${masked})"
fi

if command -v npx >/dev/null 2>&1; then
  echo "--- typescript resolveDbTarget gates ---"
  set +e
  (
    cd "${SCRIPT_DIR}/../../.."
    env -i PATH="${PATH}" HOME="${HOME:-}" \
      DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@h:5432/p" \
      npx --yes tsx -e "
        import { resolveDbTarget } from \"./tools/data-pipeline/lib/database-target-safety.ts\";
        try {
          resolveDbTarget({ target: \"production\", role: \"write\" });
          process.exit(1);
        } catch (e) {
          if (!String(e).includes(\"DATABASE_URL\")) process.exit(2);
        }
      "
  ) >"${TMP}/out" 2>"${TMP}/err"
  rc=$?
  set -e
  if [[ ${rc} -eq 0 ]]; then ok "ts DATABASE_URL refused"; else bad "ts DATABASE_URL refused"; cat "${TMP}/out" "${TMP}/err" >&2; fi

  set +e
  (
    cd "${SCRIPT_DIR}/../../.."
    env -i PATH="${PATH}" HOME="${HOME:-}" \
      LOCAL_DATABASE_URL="postgresql://postgres:x@localhost:5433/geo_core" \
      SUPABASE_WRITE_DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
      DATABASE_URL="postgresql://postgres.locghyuranqaqsnbxflc:x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
      npx --yes tsx -e "
        import { resolveDbTarget } from \"./tools/data-pipeline/lib/database-target-safety.ts\";
        const r = resolveDbTarget({ target: \"production\", role: \"write\" });
        if (!r.label.includes(\"SUPABASE_WRITE_DATABASE_URL\")) process.exit(1);
        if (r.maskedUrl.includes(\":x@\")) process.exit(2);
      "
  ) >"${TMP}/out" 2>"${TMP}/err"
  rc=$?
  set -e
  if [[ ${rc} -eq 0 ]]; then ok "ts WRITE preferred"; else bad "ts WRITE preferred"; cat "${TMP}/out" "${TMP}/err" >&2; fi
else
  echo "skip tsx tests (npx unavailable)"
fi

echo ""
echo "===== summary PASS=${PASS} FAIL=${FAIL} ====="
[[ "${FAIL}" -eq 0 ]] || exit 1
echo "database_target_safety_tests: ALL CHECKS PASSED"
