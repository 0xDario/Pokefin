#!/bin/zsh
# The Pokefin Weekly — launchd wrapper.
# Runs the report generator and posts a macOS notification on completion.
# Scheduled via ~/Library/LaunchAgents/com.pokefin.weekly.plist (Fridays 17:00).

set -u

REPO="/Users/darioturchi/repos/Pokefin"
PY="$REPO/venv/bin/python"
LOG="$REPO/reports/weekly_report.log"

cd "$REPO" || exit 1
mkdir -p "$REPO/reports"
echo "=== run $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"

# launchd hands a job no shell environment, so source the credentials file the
# scraper uses. Without this the report authenticates only if the legacy
# secretsFile.py is still present, and it breaks the day that file is removed
# in favour of the env file (see secrets_loader.py, audit follow-up DB-1).
ENV_FILE="${POKEFIN_ENV_FILE:-$HOME/.config/pokefin/env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
else
  echo "WARN: $ENV_FILE not found; secrets_loader.py will fall back to secretsFile.py" >> "$LOG"
fi

OUTPUT=$("$PY" "$REPO/generate_weekly_report.py" 2>&1)
STATUS=$?
echo "$OUTPUT" >> "$LOG"

# Verify THIS run produced a PDF, rather than trusting whatever happens to be
# newest in reports/. The old check picked the newest dated PDF on disk, so a
# failed run announced last week's file as new — and because the generator
# exited 0 when Chrome was missing, the success branch fired.
PDF=$(printf '%s\n' "$OUTPUT" | sed -n 's/^REPORT_PDF=//p' | tail -1)

if [ $STATUS -eq 0 ] && [ -n "$PDF" ] && [ -f "$PDF" ]; then
  NAME=$(basename "$PDF")
  echo "OK -> $NAME" >> "$LOG"
  osascript -e "display notification \"$NAME is ready in reports/\" with title \"The Pokéfin Weekly 📰\" subtitle \"New investment report generated\" sound name \"Glass\""
else
  echo "FAILED (status $STATUS, pdf='${PDF:-none}')" >> "$LOG"
  osascript -e "display notification \"Generation failed — see reports/weekly_report.log\" with title \"The Pokéfin Weekly 📰\" subtitle \"Error\" sound name \"Basso\""
fi

# launchd should see the failure too.
exit $STATUS
