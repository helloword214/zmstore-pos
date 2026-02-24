#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="/Users/johnmichaell.benito/Desktop/client project/zmstore-pos-2/.env"
LOG_DIR="$ROOT_DIR/docs/automation/logs"
LOG_FILE="$LOG_DIR/ui-monitor-session.log"
LOCK_DIR="$LOG_DIR/ui-monitor-session.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"
INTERVAL_SECONDS="${UI_MONITOR_INTERVAL_SECONDS:-10800}"
ROLE_SCOPE="${UI_ROLE_SCOPE:-all}"

mkdir -p "$LOG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ui-monitor] Missing env file: $ENV_FILE" | tee -a "$LOG_FILE"
  exit 1
fi

if ! command -v caffeinate >/dev/null 2>&1; then
  echo "[ui-monitor] Missing required command: caffeinate" | tee -a "$LOG_FILE"
  exit 1
fi

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_PID_FILE"
    return
  fi

  if [[ -f "$LOCK_PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "[ui-monitor] Another session is already running (pid=$existing_pid)." | tee -a "$LOG_FILE"
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

acquire_lock
caffeinate -dims &
CAFFEINATE_PID=$!

echo "[ui-monitor] Session started at $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG_FILE"
echo "[ui-monitor] Root: $ROOT_DIR" | tee -a "$LOG_FILE"
echo "[ui-monitor] Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "[ui-monitor] Interval: ${INTERVAL_SECONDS}s" | tee -a "$LOG_FILE"
echo "[ui-monitor] Lock dir: $LOCK_DIR" | tee -a "$LOG_FILE"

while true; do
  echo "[ui-monitor] Run begin $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG_FILE"
  set +e
  (
    cd "$ROOT_DIR"
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    UI_ROLE_SCOPE="$ROLE_SCOPE" npm run ui:cycle
  ) 2>&1 | tee -a "$LOG_FILE"
  RUN_EXIT_CODE=${PIPESTATUS[0]}
  set -e

  if [[ "$RUN_EXIT_CODE" -eq 0 ]]; then
    echo "[ui-monitor] Run result: PASS" | tee -a "$LOG_FILE"
  else
    echo "[ui-monitor] Run result: FAIL (exit=$RUN_EXIT_CODE)" | tee -a "$LOG_FILE"
  fi

  echo "[ui-monitor] Run end $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG_FILE"
  echo "[ui-monitor] Sleeping ${INTERVAL_SECONDS}s" | tee -a "$LOG_FILE"
  sleep "$INTERVAL_SECONDS"
done
