#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="/Users/johnmichaell.benito/Desktop/client project/zmstore-pos-2/.env"
INCIDENTS_DIR="$ROOT_DIR/docs/automation/incidents"
LOG_DIR="$ROOT_DIR/docs/automation/logs"
LOG_FILE="$LOG_DIR/ui-repair-session.log"
LOCK_DIR="$LOG_DIR/ui-repair-session.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"
STATE_FILE="$LOG_DIR/ui-repair-session.state"
INTERVAL_SECONDS="${UI_REPAIR_INTERVAL_SECONDS:-10800}"
REQUIRE_REPEAT_SECONDARY="${UI_REPAIR_REQUIRE_REPEAT_SECONDARY:-1}"
REPAIR_COMMAND="${UI_REPAIR_COMMAND:-}"
ALLOW_PLACEHOLDER_REPAIR_COMMAND="${UI_REPAIR_ALLOW_PLACEHOLDER:-0}"
FAILED_LINES_PARSER="grep"

mkdir -p "$LOG_DIR"

if [[ ! -d "$INCIDENTS_DIR" ]]; then
  echo "[ui-repair] Missing incidents dir: $INCIDENTS_DIR" | tee -a "$LOG_FILE"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ui-repair] Missing env file: $ENV_FILE" | tee -a "$LOG_FILE"
  exit 1
fi

if ! command -v caffeinate >/dev/null 2>&1; then
  echo "[ui-repair] Missing required command: caffeinate" | tee -a "$LOG_FILE"
  exit 1
fi

if command -v rg >/dev/null 2>&1; then
  FAILED_LINES_PARSER="rg"
fi

validate_repair_command() {
  if [[ -z "$REPAIR_COMMAND" ]]; then
    echo "[ui-repair] UI_REPAIR_COMMAND is required. Example: UI_REPAIR_COMMAND='npm run ui:cycle'" | tee -a "$LOG_FILE"
    exit 1
  fi

  if [[ "$ALLOW_PLACEHOLDER_REPAIR_COMMAND" != "1" ]]; then
    if echo "$REPAIR_COMMAND" | grep -Eqi 'set real repair command here|repair_triggered'; then
      echo "[ui-repair] Refusing placeholder UI_REPAIR_COMMAND. Set a real repair command." | tee -a "$LOG_FILE"
      exit 1
    fi
  fi
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_PID_FILE"
    return
  fi

  if [[ -f "$LOCK_PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "[ui-repair] Another session is already running (pid=$existing_pid)." | tee -a "$LOG_FILE"
      exit 1
    fi
  fi

  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  echo "$$" > "$LOCK_PID_FILE"
}

release_lock() {
  if [[ -d "$LOCK_DIR" ]]; then
    rm -rf "$LOCK_DIR"
  fi
}

cleanup() {
  if [[ -n "${CAFFEINATE_PID:-}" ]] && kill -0 "$CAFFEINATE_PID" >/dev/null 2>&1; then
    kill "$CAFFEINATE_PID" >/dev/null 2>&1 || true
  fi
  release_lock
}
trap cleanup EXIT INT TERM

read_state() {
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
  fi
  LAST_INCIDENT_FILE="${LAST_INCIDENT_FILE:-}"
  LAST_SECONDARY_FINGERPRINT="${LAST_SECONDARY_FINGERPRINT:-}"
}

write_state() {
  cat > "$STATE_FILE" <<STATE
LAST_INCIDENT_FILE="$LAST_INCIDENT_FILE"
LAST_SECONDARY_FINGERPRINT="$LAST_SECONDARY_FINGERPRINT"
STATE
}

latest_incident_file() {
  ls -t "$INCIDENTS_DIR"/*.md 2>/dev/null | head -n 1 || true
}

extract_failed_lines() {
  local incident_file="$1"
  if [[ "$FAILED_LINES_PARSER" == "rg" ]]; then
    rg '^- \[failed\]' "$incident_file" || true
    return
  fi
  grep -E '^- \[failed\]' "$incident_file" || true
}

has_primary_mismatch() {
  local failed_lines="$1"
  if echo "$failed_lines" | grep -Eqi 'rider dashboard|cashier dashboard'; then
    return 0
  fi
  return 1
}

secondary_fingerprint() {
  local failed_lines="$1"
  if [[ -z "$failed_lines" ]]; then
    echo ""
    return
  fi
  echo "$failed_lines" | sed 's/[[:space:]]\+/ /g' | tr '[:upper:]' '[:lower:]' | sort | tr '\n' '|'
}

run_repair_command() {
  local reason="$1"
  echo "[ui-repair] Triggered ($reason). Running UI_REPAIR_COMMAND..." | tee -a "$LOG_FILE"

  set +e
  (
    cd "$ROOT_DIR"
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    bash -lc "$REPAIR_COMMAND"
  ) 2>&1 | tee -a "$LOG_FILE"
  local cmd_exit=${PIPESTATUS[0]}
  set -e

  if [[ "$cmd_exit" -eq 0 ]]; then
    echo "[ui-repair] UI_REPAIR_COMMAND finished: PASS" | tee -a "$LOG_FILE"
  else
    echo "[ui-repair] UI_REPAIR_COMMAND finished: FAIL (exit=$cmd_exit)" | tee -a "$LOG_FILE"
  fi
}

validate_repair_command
acquire_lock
caffeinate -dims &
CAFFEINATE_PID=$!

echo "[ui-repair] Session started at $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG_FILE"
echo "[ui-repair] Root: $ROOT_DIR" | tee -a "$LOG_FILE"
echo "[ui-repair] Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "[ui-repair] Interval: ${INTERVAL_SECONDS}s" | tee -a "$LOG_FILE"
echo "[ui-repair] Require repeat secondary: ${REQUIRE_REPEAT_SECONDARY}" | tee -a "$LOG_FILE"
echo "[ui-repair] Failed-line parser: ${FAILED_LINES_PARSER}" | tee -a "$LOG_FILE"
echo "[ui-repair] Lock dir: $LOCK_DIR" | tee -a "$LOG_FILE"

while true; do
  read_state
  current_incident="$(latest_incident_file)"

  if [[ -z "$current_incident" ]]; then
    echo "[ui-repair] No incidents found; sleeping ${INTERVAL_SECONDS}s" | tee -a "$LOG_FILE"
    sleep "$INTERVAL_SECONDS"
    continue
  fi

  if [[ "$current_incident" == "$LAST_INCIDENT_FILE" ]]; then
    echo "[ui-repair] No new incident since last cycle; sleeping ${INTERVAL_SECONDS}s" | tee -a "$LOG_FILE"
    sleep "$INTERVAL_SECONDS"
    continue
  fi

  failed_lines="$(extract_failed_lines "$current_incident")"
  current_fp="$(secondary_fingerprint "$failed_lines")"
  echo "[ui-repair] Processing incident: $(basename "$current_incident")" | tee -a "$LOG_FILE"

  if [[ -z "$failed_lines" ]]; then
    echo "[ui-repair] Incident has no [failed] samples. No repair action." | tee -a "$LOG_FILE"
  elif has_primary_mismatch "$failed_lines"; then
    run_repair_command "PRIMARY_MISMATCH"
  else
    if [[ "$REQUIRE_REPEAT_SECONDARY" == "1" ]]; then
      if [[ -n "$LAST_SECONDARY_FINGERPRINT" && "$current_fp" == "$LAST_SECONDARY_FINGERPRINT" ]]; then
        run_repair_command "REPEATED_SECONDARY_MISMATCH"
      else
        echo "[ui-repair] Secondary mismatch observed once; waiting for repeat before repair." | tee -a "$LOG_FILE"
      fi
    else
      run_repair_command "SECONDARY_MISMATCH"
    fi
  fi

  LAST_INCIDENT_FILE="$current_incident"
  LAST_SECONDARY_FINGERPRINT="$current_fp"
  write_state

  echo "[ui-repair] Cycle complete; sleeping ${INTERVAL_SECONDS}s" | tee -a "$LOG_FILE"
  sleep "$INTERVAL_SECONDS"
done
