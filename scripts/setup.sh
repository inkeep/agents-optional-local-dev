#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# Inkeep Agents — Optional Services Setup
#
# Manages local development services: Nango, SigNoz, OTEL Collector, Jaeger.
# Normally invoked via the bootstrap shim in the agents monorepo or quickstart
# template (pnpm setup-dev:optional). Can also be run directly:
#
#   CALLER_ENV_FILE=/path/to/.env ./scripts/setup.sh
#   ./scripts/setup.sh --stop
#   ./scripts/setup.sh --status
#
# Environment:
#   CALLER_ENV_FILE   Path to the caller's .env file (required for setup/reset)
#   COMPANION_DIR     Override companion repo root (default: auto-detected from script location)

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Resolve paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPANION_DIR="${COMPANION_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${CALLER_ENV_FILE:-}"

# ── Pre-flight checks ────────────────────────────────────────────────────────
check_docker() {
  if ! docker ps >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running.${NC}"
    echo "  Start Docker Desktop (or the Docker daemon) and try again."
    exit 1
  fi
}

check_env_file() {
  if [ -z "$ENV_FILE" ]; then
    echo -e "${RED}Error: CALLER_ENV_FILE is not set.${NC}"
    echo "  Either run this via 'pnpm setup-dev:optional' from your project,"
    echo "  or set CALLER_ENV_FILE=/path/to/your/.env before running this script."
    exit 1
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}Error: .env file not found at $ENV_FILE${NC}"
    echo "  Run 'pnpm setup-dev' first to create the core environment, then re-run this command."
    exit 1
  fi
}

# ── Helpers ───────────────────────────────────────────────────────────────────

# Set an env var in a dotenv file. Updates existing key or appends.
# Usage: set_env_var FILE KEY VALUE
set_env_var() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then
    echo "$key=$value" > "$file"
    return
  fi
  # If key exists (uncommented), replace the line
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Use a temp file for portable sed -i; escape sed special chars in value
    local tmp="$file.tmp.$$"
    local escaped_value
    escaped_value=$(printf '%s\n' "$value" | sed -e 's/[&/\|]/\\&/g')
    sed "s|^${key}=.*|${key}=${escaped_value}|" "$file" > "$tmp" && mv "$tmp" "$file"
  else
    echo "$key=$value" >> "$file"
  fi
}

# Get an env var value from a dotenv file. Returns empty string if not set.
# Usage: get_env_var FILE KEY
get_env_var() {
  local file="$1" key="$2"
  if [ -f "$file" ]; then
    grep "^${key}=" "$file" 2>/dev/null | head -1 | cut -d'=' -f2-
  fi
}

# Wait for an HTTP endpoint to respond (up to a timeout).
# Usage: wait_for_http URL LABEL TIMEOUT_SECONDS
wait_for_http() {
  local url="$1" label="$2" timeout="${3:-60}"
  local elapsed=0
  printf "  Waiting for %s to be ready" "$label"
  while ! curl -sf "$url" >/dev/null 2>&1; do
    if [ "$elapsed" -ge "$timeout" ]; then
      echo ""
      echo -e "${RED}  Timed out waiting for $label after ${timeout}s${NC}"
      echo "  URL: $url"
      return 1
    fi
    printf "."
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo ""
  echo -e "  ${GREEN}✓${NC} $label is ready"
}

# ── Subcommands ───────────────────────────────────────────────────────────────

cmd_stop() {
  check_docker
  echo -e "${BOLD}Stopping optional services...${NC}"
  docker compose -f "$COMPANION_DIR/docker-compose.yml" \
    --profile nango --profile signoz --profile otel-collector --profile jaeger \
    down 2>/dev/null || true
  echo -e "${GREEN}✓${NC} Optional services stopped"
}

cmd_status() {
  check_docker
  echo -e "${BOLD}Optional services status${NC}"
  echo ""
  echo -e "  ${CYAN}Companion repo:${NC} $COMPANION_DIR"
  echo ""
  CONTAINER_COUNT=$(docker compose -f "$COMPANION_DIR/docker-compose.yml" \
    --profile nango --profile signoz --profile otel-collector --profile jaeger \
    ps -q 2>/dev/null | wc -l | tr -d ' ')
  if [ "$CONTAINER_COUNT" -gt 0 ] 2>/dev/null; then
    docker compose -f "$COMPANION_DIR/docker-compose.yml" \
      --profile nango --profile signoz --profile otel-collector --profile jaeger \
      ps 2>/dev/null
  else
    echo "  No optional service containers are running."
    echo "  Run 'pnpm setup-dev:optional' to start them."
  fi
}

cmd_reset() {
  check_docker
  check_env_file
  echo -e "${BOLD}Resetting optional services (full nuke + re-setup)...${NC}"
  echo ""
  echo "  Tearing down containers and volumes..."
  docker compose -f "$COMPANION_DIR/docker-compose.yml" \
    --profile nango --profile signoz --profile otel-collector --profile jaeger \
    down -v 2>/dev/null || true
  echo "  Removing companion .env..."
  rm -f "$COMPANION_DIR/.env"
  echo "  Clearing stale keys from main .env..."
  set_env_var "$ENV_FILE" "NANGO_SECRET_KEY" ""
  set_env_var "$ENV_FILE" "SIGNOZ_API_KEY" ""
  echo -e "  ${GREEN}✓${NC} Companion state cleared"
  echo ""
  echo "  Re-running setup..."
  cmd_setup
}

# ── Main setup ────────────────────────────────────────────────────────────────

cmd_setup() {
  check_docker
  check_env_file

  echo ""
  echo "================================================"
  echo "  Inkeep Agents — Optional Services Setup"
  echo "================================================"
  echo ""

  # ── Generate companion .env ──────────────────────────────────────────────
  echo "Configuring companion .env..."

  COMPANION_ENV="$COMPANION_DIR/.env"

  # Generate encryption key only if not already set
  EXISTING_ENC_KEY="$(get_env_var "$COMPANION_ENV" "NANGO_ENCRYPTION_KEY")"
  if [ -z "$EXISTING_ENC_KEY" ]; then
    ENC_KEY="$(openssl rand -base64 32)"
    set_env_var "$COMPANION_ENV" "NANGO_ENCRYPTION_KEY" "$ENC_KEY"
    echo -e "  ${GREEN}✓${NC} Generated NANGO_ENCRYPTION_KEY"
  else
    echo -e "  ${GREEN}✓${NC} NANGO_ENCRYPTION_KEY already set"
  fi

  # Generate Nango secret key for the dev environment (used for API auth)
  EXISTING_NANGO_KEY="$(get_env_var "$ENV_FILE" "NANGO_SECRET_KEY")"
  if [ -n "$EXISTING_NANGO_KEY" ]; then
    # Re-use existing key — also ensure it's in the companion .env
    set_env_var "$COMPANION_ENV" "NANGO_SECRET_KEY_DEV" "$EXISTING_NANGO_KEY"
    echo -e "  ${GREEN}✓${NC} Re-using existing NANGO_SECRET_KEY"
  else
    # Nango validates keys as UUID v4. Generate one portably (openssl + sed).
    _hex="$(openssl rand -hex 16)"
    NANGO_KEY="$(echo "$_hex" | sed 's/^\(.\{8\}\)\(.\{4\}\).\(.\{3\}\).\(.\{3\}\)\(.\{12\}\)$/\1-\2-4\3-a\4-\5/')"
    set_env_var "$COMPANION_ENV" "NANGO_SECRET_KEY_DEV" "$NANGO_KEY"
    set_env_var "$ENV_FILE" "NANGO_SECRET_KEY" "$NANGO_KEY"
    echo -e "  ${GREEN}✓${NC} Generated NANGO_SECRET_KEY"
  fi

  set_env_var "$COMPANION_ENV" "COMPOSE_PROFILES" "nango,signoz,otel-collector,jaeger"
  echo -e "  ${GREEN}✓${NC} COMPOSE_PROFILES set"

  # ── Start Docker Compose ─────────────────────────────────────────────────
  echo ""
  echo "Starting optional services..."
  docker compose -f "$COMPANION_DIR/docker-compose.yml" \
    --profile nango --profile signoz --profile otel-collector --profile jaeger \
    up -d 2>&1

  echo -e "${GREEN}✓${NC} Docker Compose started"

  # ── Wait for services and wire env vars ──────────────────────────────────
  echo ""
  echo "Waiting for services to become healthy..."

  # Nango (non-fatal — first run may need time for DB migrations)
  if ! wait_for_http "http://localhost:3050/health" "Nango" 180; then
    echo -e "  ${YELLOW}Nango is still starting but env vars are already configured.${NC}"
    echo -e "  ${YELLOW}The API key will work once Nango finishes booting.${NC}"
  fi

  set_env_var "$ENV_FILE" "NANGO_SERVER_URL" "http://localhost:3050"
  set_env_var "$ENV_FILE" "PUBLIC_NANGO_SERVER_URL" "http://localhost:3050"
  set_env_var "$ENV_FILE" "PUBLIC_NANGO_CONNECT_BASE_URL" "http://localhost:3051"
  echo -e "  ${GREEN}✓${NC} Nango env vars written to .env"

  # OTEL vars (no auth required for sending traces)
  set_env_var "$ENV_FILE" "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT" "http://localhost:14318/v1/traces"
  set_env_var "$ENV_FILE" "OTEL_SERVICE_NAME" "inkeep-agents"
  echo -e "  ${GREEN}✓${NC} OTEL env vars written to .env"

  # SigNoz (non-fatal — SigNoz has many infra services and may be slow to start)
  SIGNOZ_READY=1
  if ! wait_for_http "http://localhost:3080/api/v1/health" "SigNoz" 240; then
    SIGNOZ_READY=0
    echo -e "  ${YELLOW}SigNoz is still starting. Env vars will be set, but API key automation will be skipped.${NC}"
    echo -e "  ${YELLOW}Once SigNoz is ready, re-run 'pnpm setup-dev:optional' or create an API key at http://localhost:3080${NC}"
  fi

  set_env_var "$ENV_FILE" "SIGNOZ_URL" "http://localhost:3080"
  set_env_var "$ENV_FILE" "PUBLIC_SIGNOZ_URL" "http://localhost:3080"

  # ── Automate SigNoz API key ──────────────────────────────────────────────
  echo ""
  echo "Setting up SigNoz API key..."

  EXISTING_SIGNOZ_KEY="$(get_env_var "$ENV_FILE" "SIGNOZ_API_KEY")"
  if [ -n "$EXISTING_SIGNOZ_KEY" ]; then
    echo -e "  ${GREEN}✓${NC} SIGNOZ_API_KEY already configured"
  elif [ "$SIGNOZ_READY" = "0" ]; then
    echo -e "  ${YELLOW}⚠️  Skipped — SigNoz not ready yet. Re-run 'pnpm setup-dev:optional' once it's up.${NC}"
  else
    SIGNOZ_URL="http://localhost:3080"
    SIGNOZ_EMAIL="admin@localhost.dev"
    SIGNOZ_PASSWORD='LocalDev1234@'

    # Register admin (idempotent — fails silently on re-run)
    curl -s -X POST "$SIGNOZ_URL/api/v1/register" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"Admin\",\"email\":\"$SIGNOZ_EMAIL\",\"password\":\"$SIGNOZ_PASSWORD\",\"orgDisplayName\":\"Local Dev\"}" \
      >/dev/null 2>&1 || true

    # Login to get JWT (use -s without -f so we get the response body on errors too)
    LOGIN_RESPONSE=$(curl -s -X POST "$SIGNOZ_URL/api/v1/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$SIGNOZ_EMAIL\",\"password\":\"$SIGNOZ_PASSWORD\"}" 2>/dev/null || echo "")

    if [ -n "$LOGIN_RESPONSE" ]; then
      ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log((d.data||d).accessJwt||'')" 2>/dev/null || echo "")

      if [ -n "$ACCESS_TOKEN" ]; then
        # Create PAT (use -s without -f)
        PAT_RESPONSE=$(curl -s -X POST "$SIGNOZ_URL/api/v1/pats" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $ACCESS_TOKEN" \
          -d '{"name":"local-dev-automation","role":"ADMIN","expiresAt":0}' 2>/dev/null || echo "")

        if [ -n "$PAT_RESPONSE" ]; then
          SIGNOZ_API_KEY=$(echo "$PAT_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log((d.data||d).token||'')" 2>/dev/null || echo "")

          if [ -n "$SIGNOZ_API_KEY" ]; then
            set_env_var "$ENV_FILE" "SIGNOZ_API_KEY" "$SIGNOZ_API_KEY"
            echo -e "  ${GREEN}✓${NC} SigNoz API key created and written to .env"
          else
            echo -e "  ${YELLOW}⚠️  Could not extract SigNoz API key. You may need to create one manually at $SIGNOZ_URL${NC}"
          fi
        else
          echo -e "  ${YELLOW}⚠️  Could not create SigNoz PAT. You may need to create one manually at $SIGNOZ_URL${NC}"
        fi
      else
        echo -e "  ${YELLOW}⚠️  Could not login to SigNoz. You may need to create an API key manually at $SIGNOZ_URL${NC}"
      fi
    else
      echo -e "  ${YELLOW}⚠️  Could not connect to SigNoz API. You may need to create an API key manually at $SIGNOZ_URL${NC}"
    fi
  fi

  # ── Summary ──────────────────────────────────────────────────────────────
  echo ""
  echo "================================================"
  echo -e "${GREEN}  Optional Services Setup Complete!${NC}"
  echo "================================================"
  echo ""
  echo "Services running:"
  echo -e "  ${CYAN}Nango${NC}            http://localhost:3050  (API + dashboard)"
  echo -e "  ${CYAN}Nango Connect${NC}    http://localhost:3051  (websocket)"
  echo -e "  ${CYAN}OTEL Collector${NC}   http://localhost:14318 (trace receiver)"
  echo -e "  ${CYAN}SigNoz${NC}           http://localhost:3080  (trace viewer)"
  echo -e "  ${CYAN}Jaeger${NC}           http://localhost:16686 (trace viewer)"
  echo ""
  echo "Lifecycle commands:"
  echo "  pnpm optional:stop      Stop optional services"
  echo "  pnpm optional:status    Show service status"
  echo "  pnpm optional:reset     Nuke data + re-setup from scratch"
  echo ""
  echo -e "${YELLOW}  If pnpm dev is already running, restart it to pick up the new env vars.${NC}"
  echo ""
}

# ── Argument parsing ──────────────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --stop)    cmd_stop; exit 0 ;;
    --status)  cmd_status; exit 0 ;;
    --reset)   cmd_reset; exit 0 ;;
    --no-update) ;; # Handled by bootstrap shim — no-op here
    --) ;; # End-of-options separator (from pnpm -- passthrough)
    --help|-h)
      echo "Usage: ./scripts/setup.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --stop        Stop optional services (containers only, keeps data)"
      echo "  --status      Show status of optional services"
      echo "  --reset       Nuke optional service data + re-setup from scratch"
      echo "  --no-update   (No-op here — handled by bootstrap shim)"
      echo "  --help, -h    Show this help"
      echo ""
      echo "Environment:"
      echo "  CALLER_ENV_FILE  Path to caller's .env (required for setup/reset)"
      echo "  COMPANION_DIR    Override companion repo root (auto-detected)"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown argument: $arg${NC}"
      echo "Run with --help for usage."
      exit 1
      ;;
  esac
done

cmd_setup
