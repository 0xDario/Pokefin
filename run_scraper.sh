#!/bin/bash

set -o pipefail

# Set variables
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$PROJECT_DIR/scraper.log"

# Function to log with timestamp to both console and file
log_message() {
    local message="$(date '+%Y-%m-%d %H:%M:%S') - $1"
    echo "$message" | tee -a "$LOG_FILE"
}

echo "Starting Pokefin..."

# Navigate to project directory
cd "$PROJECT_DIR" || {
    log_message "ERROR: Cannot change to directory $PROJECT_DIR"
    exit 1
}

log_message "Changed to directory: $PROJECT_DIR"

# Load secrets from out-of-tree env file. Expected contents (KEY=VALUE,
# no 'export', chmod 600):
#   SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
# Override the path via POKEFIN_ENV_FILE if your secrets live elsewhere.
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

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    log_message "ERROR: Virtual environment 'venv' not found"
    exit 1
fi

log_message "Virtual environment found"

# Activate virtual environment
# shellcheck disable=SC1091
source venv/bin/activate || {
    log_message "ERROR: Failed to activate virtual environment"
    exit 1
}

log_message "Virtual environment activated"

# Check if main.py exists
if [ ! -f "main.py" ]; then
    log_message "ERROR: main.py not found"
    deactivate
    exit 1
fi

log_message "main.py found"

# Run the Python script
log_message "Starting TCG Player scraper execution"

# Capture both stdout and stderr, display on console and log to file
python main.py --run-now 2>&1 | while IFS= read -r line; do
    echo "SCRAPER: $line" | tee -a "$LOG_FILE"
done

# Capture the exit status properly
exit_code=${PIPESTATUS[0]}

# Check exit status
if [ "$exit_code" -eq 0 ]; then
    log_message "TCG Player scraper completed successfully"
else
    log_message "ERROR: TCG Player scraper failed with exit code $exit_code"
fi

# Deactivate virtual environment
deactivate
log_message "Virtual environment deactivated"
echo "Script completed!"
exit "$exit_code"
