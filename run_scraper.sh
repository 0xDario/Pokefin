#!/bin/bash

# Cron wrapper for the Pokefin price scraper.
# Loads secrets from an out-of-tree env file (so the service-role key
# never lives in the repo), activates the venv, runs main.py, logs to
# scraper.log.

set -o pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$PROJECT_DIR/scraper.log"

log_message() {
    local message="$(date '+%Y-%m-%d %H:%M:%S') - $1"
    echo "$message" | tee -a "$LOG_FILE"
}

echo "Starting Pokefin..."

cd "$PROJECT_DIR" || {
    log_message "ERROR: Cannot change to directory $PROJECT_DIR"
    exit 1
}
log_message "Changed to directory: $PROJECT_DIR"

# Load secrets from out-of-tree env file. The expected file holds:
#   SUPABASE_URL=https://...
#   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
# It must be chmod 600 and outside the repo.
ENV_FILE="${POKEFIN_ENV_FILE:-$HOME/.config/pokefin/env}"
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    log_message "Loaded env from $ENV_FILE"
else
    log_message "WARN: $ENV_FILE not found; secrets_loader.py will fall back to secretsFile.py"
fi

if [ ! -d "venv" ]; then
    log_message "ERROR: Virtual environment 'venv' not found"
    exit 1
fi
log_message "Virtual environment found"

# shellcheck disable=SC1091
source venv/bin/activate || {
    log_message "ERROR: Failed to activate virtual environment"
    exit 1
}
log_message "Virtual environment activated"

if [ ! -f "main.py" ]; then
    log_message "ERROR: main.py not found"
    deactivate
    exit 1
fi
log_message "main.py found"

log_message "Starting TCG Player scraper execution"

python main.py --run-now 2>&1 | while IFS= read -r line; do
    echo "SCRAPER: $line" | tee -a "$LOG_FILE"
done

exit_code=${PIPESTATUS[0]}

if [ "$exit_code" -eq 0 ]; then
    log_message "TCG Player scraper completed successfully"
else
    log_message "ERROR: TCG Player scraper failed with exit code $exit_code"
fi

deactivate
log_message "Virtual environment deactivated"
echo "Script completed!"
exit "$exit_code"
