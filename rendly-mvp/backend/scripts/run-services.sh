#!/usr/bin/env bash
# Run every backend service locally on fixed ports.
#
#   scripts/run-services.sh install   install dependencies for each service
#   scripts/run-services.sh start     start all services in the background
#   scripts/run-services.sh stop      stop services started by "start"
#   scripts/run-services.sh status    check each service's /health endpoint
#
# Logs go to backend/.run/logs/<service>.log. Environment variables such as
# DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and JWT_SECRET are read
# from the environment or from backend/.env (loaded by each service).
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$BACKEND_DIR/.run"
LOG_DIR="$RUN_DIR/logs"

# service name : directory : port env var : port
SERVICES=(
  "auth-service:services/auth-service:AUTH_SERVICE_PORT:4001"
  "user-service:services/user-service:USER_SERVICE_PORT:3002"
  "matching-service:services/matching-service:MATCHING_SERVICE_PORT:3003"
  "chat-service:services/chat-service:CHAT_SERVICE_PORT:3004"
  "video-service:services/video-service:VIDEO_SERVICE_PORT:3005"
  "moderation-service:services/moderation-service:MODERATION_SERVICE_PORT:3006"
  "huddle-service:services/huddle-service:HUDDLE_SERVICE_PORT:3007"
  "admin-service:services/admin-service:ADMIN_SERVICE_PORT:3008"
)

cmd_install() {
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r name dir _ _ <<<"$entry"
    if [ ! -d "$BACKEND_DIR/$dir/node_modules" ]; then
      echo "installing $name"
      (cd "$BACKEND_DIR/$dir" && npm install --no-audit --no-fund)
    fi
  done
}

cmd_start() {
  mkdir -p "$LOG_DIR"
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r name dir port_var port <<<"$entry"
    pid_file="$RUN_DIR/$name.pid"
    if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      echo "$name already running (pid $(cat "$pid_file"))"
      continue
    fi
    # Fixed port per service; an explicit value in the environment still wins.
    port_value="${!port_var:-$port}"
    (
      cd "$BACKEND_DIR/$dir"
      export "$port_var=$port_value" PORT="$port_value"
      # setsid gives each service its own process group so stop can end npx and its child.
      setsid nohup npx ts-node src/server.ts >"$LOG_DIR/$name.log" 2>&1 &
      echo $! >"$pid_file"
    )
    echo "started $name on port $port_value (log: $LOG_DIR/$name.log)"
  done
  wait_until_healthy
}

# Wait for each service started by "start" to answer /health with 200.
# Fails fast if its process has exited, and prints the tail of its log.
wait_until_healthy() {
  local timeout_seconds="${START_TIMEOUT_SECONDS:-120}"
  local failed=0
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r name _ port_var port <<<"$entry"
    port_value="${!port_var:-$port}"
    pid_file="$RUN_DIR/$name.pid"
    pid="$(cat "$pid_file" 2>/dev/null || echo "")"
    waited=0
    code=000
    while [ "$waited" -lt "$timeout_seconds" ]; do
      code="$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://localhost:$port_value/health" || true)"
      if [ "$code" = "200" ]; then
        echo "healthy  $name on port $port_value"
        continue 2
      fi
      if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 2
      waited=$((waited + 2))
    done
    failed=1
    echo "FAILED   $name on port $port_value (last /health: $code)"
    echo "         last log lines:"
    tail -n 8 "$LOG_DIR/$name.log" 2>/dev/null | sed 's/^/           /'
  done
  if [ "$failed" -ne 0 ]; then
    echo "one or more services did not start. Fix the errors above, then run: scripts/run-services.sh start"
    return 1
  fi
  echo "all services healthy"
}

cmd_stop() {
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r name _ _ _ <<<"$entry"
    pid_file="$RUN_DIR/$name.pid"
    if [ -f "$pid_file" ]; then
      pid="$(cat "$pid_file")"
      # ts-node runs under npx; stop the whole process group.
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      rm -f "$pid_file"
      echo "stopped $name"
    fi
  done
}

cmd_status() {
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r name _ port_var port <<<"$entry"
    port_value="${!port_var:-$port}"
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://localhost:$port_value/health" || true)"
    printf '%-20s port %-5s /health %s\n' "$name" "$port_value" "$code"
  done
}

case "${1:-}" in
  install) cmd_install ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) echo "usage: $0 {install|start|stop|status}"; exit 1 ;;
esac
