#!/bin/zsh
# The Pokefin Weekly — launchd wrapper.
# Runs the report generator and posts a macOS notification on completion.
# Scheduled via ~/Library/LaunchAgents/com.pokefin.weekly.plist (Fridays 17:00).

REPO="/Users/darioturchi/repos/Pokefin"
PY="$REPO/venv/bin/python"
LOG="$REPO/reports/weekly_report.log"

cd "$REPO" || exit 1
mkdir -p "$REPO/reports"
echo "=== run $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"

"$PY" "$REPO/generate_weekly_report.py" >> "$LOG" 2>&1
STATUS=$?

# newest dated report, excluding the stable "latest" alias
LATEST=$(ls -t "$REPO"/reports/pokefin_weekly_[0-9]*.pdf 2>/dev/null | head -1)

if [ $STATUS -eq 0 ] && [ -n "$LATEST" ]; then
  NAME=$(basename "$LATEST")
  echo "OK -> $NAME" >> "$LOG"
  osascript -e "display notification \"$NAME is ready in reports/\" with title \"The Pokéfin Weekly 📰\" subtitle \"New investment report generated\" sound name \"Glass\""
else
  echo "FAILED (status $STATUS)" >> "$LOG"
  osascript -e "display notification \"Generation failed — see reports/weekly_report.log\" with title \"The Pokéfin Weekly 📰\" subtitle \"Error\" sound name \"Basso\""
fi
