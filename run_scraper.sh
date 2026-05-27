#!/bin/bash

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

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    log_message "ERROR: Virtual environment 'venv' not found"
    exit 1
fi

log_message "Virtual environment found"

# Activate virtual environment
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
if [ $exit_code -eq 0 ]; then
    log_message "TCG Player scraper completed successfully"
else
    log_message "ERROR: TCG Player scraper failed with exit code $exit_code"
fi

# Deactivate virtual environment
deactivate
log_message "Virtual environment deactivated"
echo "Script completed!"
