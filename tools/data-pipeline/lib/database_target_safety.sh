#!/usr/bin/env bash
# =============================================================================
# Database target safety (shared)
#
# Canonical env names ONLY for target resolution:
#   LOCAL_DATABASE_URL
#   SUPABASE_READ_DATABASE_URL
#   SUPABASE_WRITE_DATABASE_URL
#
# Rules:
#   - Never let generic DATABASE_URL become a production write target.
#   - Explicit --target local|production required for write-capable tools.
#   - Print masked host / database / project ref before any write.
#   - Production writes need --apply + confirmation string.
#   - Sample / classify scripts must refuse production writes.
#
# Source from pipeline tools:
#   # shellcheck source=../lib/database_target_safety.sh
#   source "${REPO_ROOT}/tools/data-pipeline/lib/database_target_safety.sh"
# =============================================================================

DB_TARGET_PRODUCTION_PROJECT_REF="${DB_TARGET_PRODUCTION_PROJECT_REF:-locghyuranqaqsnbxflc}"

db_target_die() {
  echo "error: $*" >&2
  exit 1
}

db_target_require_cmd() {
  command -v "$1" >/dev/null 2>&1 || db_target_die "required command not found: $1"
}

db_target_mask_url() {
  local url="${1:-}"
  if [[ "${url}" =~ ^postgres(ql)?://([^:/@]+):[^@]*@(.+)$ ]]; then
    echo "postgresql://${BASH_REMATCH[2]}:***@${BASH_REMATCH[3]}"
  elif [[ "${url}" =~ ^postgres(ql)?://([^@]+)@(.+)$ ]]; then
    echo "postgresql://${BASH_REMATCH[2]}@${BASH_REMATCH[3]}"
  else
    echo "postgresql://***"
  fi
}

db_target_url_fingerprint() {
  local url="${1:-}"
  python3 - "${url}" <<'PY' 2>/dev/null || true
import sys
from urllib.parse import urlparse, unquote
u = urlparse(sys.argv[1])
host = (u.hostname or "").lower()
port = u.port or (5432 if (u.scheme or "").startswith("postgres") else "")
db = (u.path or "").lstrip("/") or "postgres"
user = unquote(u.username or "")
print(f"{user}@{host}:{port}/{db}")
PY
}

db_target_extract_project_ref() {
  local url="${1:-}"
  python3 - "${url}" <<'PY' 2>/dev/null || true
import re, sys
from urllib.parse import urlparse, unquote
u = urlparse(sys.argv[1])
user = unquote(u.username or "")
host = (u.hostname or "").lower()
m = re.match(r"^postgres\.([a-z0-9]+)$", user)
if m:
    print(m.group(1)); raise SystemExit
m = re.search(r"(?:^|\.)([a-z0-9]{20})\.supabase\.(?:co|com)$", host)
if m:
    print(m.group(1)); raise SystemExit
print("")
PY
}

# Refuse DATABASE_URL as the sole/silent production write source.
# Legacy SUPABASE_DATABASE_URL is still accepted when WRITE is unset.
db_target_refuse_database_url_as_write() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    return 0
  fi
  if [[ -z "${SUPABASE_WRITE_DATABASE_URL:-}" && -z "${SUPABASE_DATABASE_URL:-}" ]]; then
    db_target_die \
      "DATABASE_URL is set but neither SUPABASE_WRITE_DATABASE_URL nor legacy SUPABASE_DATABASE_URL is set. Refuse using DATABASE_URL as production write target."
  fi
  local write_fp db_fp
  write_fp="$(db_target_url_fingerprint "${SUPABASE_WRITE_DATABASE_URL:-${SUPABASE_DATABASE_URL:-}}")"
  db_fp="$(db_target_url_fingerprint "${DATABASE_URL}")"
  if [[ -n "${write_fp}" && -n "${db_fp}" && "${write_fp}" == "${db_fp}" \
        && "${DB_TARGET_ALLOW_DATABASE_URL_SAME_AS_WRITE:-}" != "true" ]]; then
    echo "warning: DATABASE_URL fingerprint matches write URL; write resolution still uses SUPABASE_WRITE_DATABASE_URL / legacy SUPABASE_DATABASE_URL only (never DATABASE_URL)." >&2
  fi
}

# Resolve URL for an explicit target.
# Sets: DB_TARGET, DB_TARGET_DATABASE_URL, DB_TARGET_LABEL, DB_TARGET_ROLE (read|write|local)
db_target_resolve() {
  local target="${1:-}"
  local role="${2:-write}" # write | read | local

  DB_TARGET=""
  DB_TARGET_DATABASE_URL=""
  DB_TARGET_LABEL=""
  DB_TARGET_ROLE="${role}"

  case "${target}" in
    local)
      DB_TARGET="local"
      DB_TARGET_DATABASE_URL="${LOCAL_DATABASE_URL:-}"
      DB_TARGET_LABEL="local (LOCAL_DATABASE_URL)"
      DB_TARGET_ROLE="local"
      [[ -n "${DB_TARGET_DATABASE_URL}" ]] || db_target_die \
        "--target local requires LOCAL_DATABASE_URL"
      ;;
    production|prod)
      DB_TARGET="production"
      case "${role}" in
        read)
          if [[ -n "${SUPABASE_READ_DATABASE_URL:-}" ]]; then
            DB_TARGET_DATABASE_URL="${SUPABASE_READ_DATABASE_URL}"
            DB_TARGET_LABEL="production-read (SUPABASE_READ_DATABASE_URL)"
          elif [[ -n "${SUPABASE_DATABASE_URL:-}" ]]; then
            DB_TARGET_DATABASE_URL="${SUPABASE_DATABASE_URL}"
            DB_TARGET_LABEL="production-read (legacy SUPABASE_DATABASE_URL)"
            echo "warning: prefer SUPABASE_READ_DATABASE_URL for production reads." >&2
          else
            db_target_die \
              "--target production --role read requires SUPABASE_READ_DATABASE_URL (or legacy SUPABASE_DATABASE_URL)"
          fi
          ;;
        write|*)
          db_target_refuse_database_url_as_write
          if [[ -n "${SUPABASE_WRITE_DATABASE_URL:-}" ]]; then
            DB_TARGET_DATABASE_URL="${SUPABASE_WRITE_DATABASE_URL}"
            DB_TARGET_LABEL="production-write (SUPABASE_WRITE_DATABASE_URL)"
          elif [[ -n "${SUPABASE_DATABASE_URL:-}" ]]; then
            # Legacy alias only — never DATABASE_URL.
            DB_TARGET_DATABASE_URL="${SUPABASE_DATABASE_URL}"
            DB_TARGET_LABEL="production-write (legacy SUPABASE_DATABASE_URL)"
            echo "warning: prefer SUPABASE_WRITE_DATABASE_URL for production writes (legacy SUPABASE_DATABASE_URL accepted)." >&2
          else
            db_target_die \
              "--target production requires SUPABASE_WRITE_DATABASE_URL (legacy SUPABASE_DATABASE_URL allowed temporarily; DATABASE_URL is refused)"
          fi
          # Refuse treating read URL as write unless override.
          if [[ -n "${SUPABASE_READ_DATABASE_URL:-}" \
                && "${DB_TARGET_DATABASE_URL}" == "${SUPABASE_READ_DATABASE_URL}" \
                && "${SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL:-}" != "true" ]]; then
            db_target_die \
              "production write URL equals SUPABASE_READ_DATABASE_URL; set a distinct SUPABASE_WRITE_DATABASE_URL (or SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL=true)"
          fi
          ;;
      esac
      ;;
    "")
      db_target_die "missing --target local|production (refusing to infer from env)"
      ;;
    *)
      db_target_die "invalid --target '${target}' (use local or production)"
      ;;
  esac
}

db_target_refuse_ambiguous_local_vs_production() {
  local local_url="${LOCAL_DATABASE_URL:-}"
  local prod_url="${SUPABASE_WRITE_DATABASE_URL:-${SUPABASE_DATABASE_URL:-${SUPABASE_READ_DATABASE_URL:-}}}"
  if [[ -z "${local_url}" || -z "${prod_url}" ]]; then
    return 0
  fi
  local fp_local fp_prod
  fp_local="$(db_target_url_fingerprint "${local_url}")"
  fp_prod="$(db_target_url_fingerprint "${prod_url}")"
  if [[ -n "${fp_local}" && -n "${fp_prod}" && "${fp_local}" == "${fp_prod}" ]]; then
    db_target_die \
      "LOCAL_DATABASE_URL and production URL fingerprints are identical (${fp_local}); refusing"
  fi
}

db_target_verify_production_identity() {
  local url="${1:-}"
  local ref="${DB_TARGET_PRODUCTION_PROJECT_REF}"
  local found

  [[ -n "${url}" ]] || db_target_die "empty URL for production identity check"
  [[ -n "${ref}" ]] || db_target_die "DB_TARGET_PRODUCTION_PROJECT_REF is empty"

  found="$(db_target_extract_project_ref "${url}")"
  if [[ "${url}" != *"${ref}"* && "${found}" != "${ref}" ]]; then
    db_target_die \
      "production identity mismatch: expected project_ref=${ref}, got url=$(db_target_mask_url "${url}") extracted_ref=${found:-<none>}"
  fi
  if [[ "${url}" == *"localhost"* || "${url}" == *"127.0.0.1"* ]]; then
    db_target_die "production target URL points at localhost; refusing"
  fi

  echo "production_project_ref=${ref}"
  echo "production_url_fingerprint=$(db_target_url_fingerprint "${url}")"
  echo "production_url_masked=$(db_target_mask_url "${url}")"
}

# Print identity before any DB write/read that can mutate.
# Sets DB_TARGET_DB_NAME, DB_TARGET_SERVER_ADDR, DB_TARGET_SERVER_PORT, DB_TARGET_DB_USER
db_target_print_identity() {
  local url="${1:-${DB_TARGET_DATABASE_URL}}"
  local target="${2:-${DB_TARGET}}"
  db_target_require_cmd psql

  echo "=== database target identity ==="
  echo "target=${target}"
  echo "target_label=${DB_TARGET_LABEL:-}"
  echo "target_role=${DB_TARGET_ROLE:-}"
  echo "database_url=$(db_target_mask_url "${url}")"

  if [[ "${target}" == "production" ]]; then
    db_target_verify_production_identity "${url}"
  fi

  local row
  row="$(
    PAGER=cat psql "${url}" -v ON_ERROR_STOP=1 -At -F '|' -c \
      "SELECT current_database(), coalesce(host(inet_server_addr())::text, ''), coalesce(inet_server_port()::text, ''), current_user;"
  )" || db_target_die "failed to connect for target identity probe"

  DB_TARGET_DB_NAME="$(echo "${row}" | cut -d'|' -f1)"
  DB_TARGET_SERVER_ADDR="$(echo "${row}" | cut -d'|' -f2)"
  DB_TARGET_SERVER_PORT="$(echo "${row}" | cut -d'|' -f3)"
  DB_TARGET_DB_USER="$(echo "${row}" | cut -d'|' -f4)"

  echo "database=${DB_TARGET_DB_NAME}"
  echo "server_addr=${DB_TARGET_SERVER_ADDR:-unknown}"
  echo "server_port=${DB_TARGET_SERVER_PORT:-unknown}"
  echo "db_user=${DB_TARGET_DB_USER}"
  echo "================================"
}

# Production write gate: mode dry_run|apply + confirmation.
# confirmation_expected e.g. "IMPORT places yangon snapshot_v1"
db_target_require_write_gates() {
  local target="${1:-${DB_TARGET}}"
  local mode="${2:-}"
  local confirmation_expected="${3:-}"
  local confirmation_got="${4:-}"

  case "${mode}" in
    dry_run|"")
      echo "mode=dry_run (default; no durable write)"
      return 0
      ;;
    apply)
      ;;
    *)
      db_target_die "mode must be dry_run or apply (got '${mode}')"
      ;;
  esac

  if [[ "${target}" != "production" ]]; then
    echo "mode=apply target=${target}"
    return 0
  fi

  [[ -n "${confirmation_expected}" ]] || db_target_die \
    "production apply requires a confirmation expectation string"
  if [[ "${confirmation_got}" != "${confirmation_expected}" ]]; then
    db_target_die \
      "production apply refused: confirmation must be exactly \"${confirmation_expected}\" (got \"${confirmation_got:-<empty>}\")"
  fi

  db_target_verify_production_identity "${DB_TARGET_DATABASE_URL}" >/dev/null
  echo "mode=apply target=production confirmation=ok"
}

# Sample / classify / F2 scripts: local writes only.
db_target_refuse_production_for_sample() {
  local script_name="${1:-sample script}"
  if [[ "${DB_TARGET:-}" == "production" ]]; then
    db_target_die \
      "${script_name} refuses production writes (sample/classify/dry-run path). Use a dedicated --target production --apply tool."
  fi
  if [[ -n "${SUPABASE_WRITE_DATABASE_URL:-}" || -n "${SUPABASE_DATABASE_URL:-}" ]]; then
    # Allowed to be set for mirror refresh reads, but this script must not use them for writes.
    echo "note: ${script_name} uses LOCAL_DATABASE_URL only for writes."
  fi
}

# Convenience: full preflight for write tools.
# Args: target mode role confirmation_expected confirmation_got
db_target_preflight_write() {
  local target="${1:-}"
  local mode="${2:-dry_run}"
  local role="${3:-write}"
  local confirmation_expected="${4:-}"
  local confirmation_got="${5:-}"

  db_target_refuse_ambiguous_local_vs_production
  db_target_resolve "${target}" "${role}"
  db_target_print_identity "${DB_TARGET_DATABASE_URL}" "${DB_TARGET}"
  db_target_require_write_gates "${DB_TARGET}" "${mode}" "${confirmation_expected}" "${confirmation_got}"
}
