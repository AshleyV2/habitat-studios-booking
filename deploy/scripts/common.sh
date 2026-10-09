# Shared helpers for the Habitat operator scripts. Sourced, not run directly.
set -euo pipefail
HABITAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$HABITAT_DIR"

die() { echo "ERROR: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. See docs/INSTALL.md step 1."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose ...)."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running (or you need sudo / the docker group)."
}

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

wait_healthy() {
  echo -n "Waiting for the booking system to become healthy"
  for _ in $(seq 1 60); do
    if docker compose exec -T app node -e "fetch('http://127.0.0.1:8080/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      echo " — OK"
      return 0
    fi
    echo -n "."
    sleep 3
  done
  echo
  docker compose logs --tail=60 app
  die "The app did not become healthy. The logs above show why. Your data has not been changed."
}
