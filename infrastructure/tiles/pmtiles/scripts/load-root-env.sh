# shellcheck shell=bash
# Reliable dotenv loader for repository root .env (no eval, no source).
# Split each line only on the FIRST "="; values keep "=", "?", "&", ":", "@", etc.
# Compatible with: set -euo pipefail when sourced from export-region / build-region.
#
# Sourced by export-region.sh and build-region.sh.

_LOCAL_MAP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_LOCAL_MAP_REPO_ROOT="$(cd "${_LOCAL_MAP_SCRIPT_DIR}/../../../.." && pwd)"
LOCAL_MAP_ROOT_ENV_FILE="${_LOCAL_MAP_REPO_ROOT}/.env"

# Log postgresql-style DATABASE_URL host:port only (never password or full URL).
local_map_log_database_url_host() {
  local d="${DATABASE_URL:-}"
  if [[ -z "$d" ]]; then
    return 1
  fi
  if [[ "$d" =~ @([^@/?]+)(/|\?|$) ]]; then
    echo "[env] using DATABASE_URL host: ${BASH_REMATCH[1]}" >&2
    return 0
  fi
  echo "[env] DATABASE_URL is set (could not parse host for log)" >&2
  return 0
}

local_map_load_root_env_file() {
  local env_file="$LOCAL_MAP_ROOT_ENV_FILE"

  if [[ ! -f "$env_file" ]]; then
    echo "[env] no root .env at ${env_file} (set variables in the shell or CI)" >&2
    return 0
  fi

  echo "[env] loaded root .env" >&2

  local line key val existing
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    line="${line#"${line%%[![:space:]]*}"}"
    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    [[ "$line" != *=* ]] && continue

    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    val="${val%"${val##*[![:space:]]}"}"
    val="${val#"${val%%[![:space:]]*}"}"
    if [[ ${#val} -ge 2 && "$val" == \"*\" ]]; then
      val="${val#\"}"
      val="${val%\"}"
    elif [[ ${#val} -ge 2 && "$val" == \'*\' ]]; then
      val="${val#\'}"
      val="${val%\'}"
    fi

    existing="$(printenv "$key" 2>/dev/null || true)"
    if [[ -n "$existing" ]]; then
      continue
    fi

    export "${key}=${val}"
  done <"$env_file"

  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "[env] DATABASE_URL loaded" >&2
  fi
}

local_map_load_root_env_file
