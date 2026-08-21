#!/usr/bin/env bash
# The Pokefin Weekly — scheduler wrapper.
# Runs the report generator and announces the result.
# Scheduled on macOS via ~/Library/LaunchAgents/com.pokefin.weekly.plist
# (Fridays 17:00), or on the Linux scraper host via cron.

set -u

# Derive the repo from this script's own location rather than hardcoding it —
# the same file runs from ~/repos/Pokefin on macOS and ~/pokefin on the Linux
# scraper host, and a hardcoded path silently `cd`-failed on the latter.
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
REPO="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
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
SUMMARY=$(printf '%s\n' "$OUTPUT" | sed -n 's/^REPORT_SUMMARY=//p' | tail -1)

# Desktop notification where one exists; the log is the record everywhere else.
# The Linux scraper host has neither osascript nor a session bus under cron, so
# both branches degrade to the log rather than erroring.
notify() {  # notify <subtitle> <message> <macos-sound>
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$2\" with title \"The Pokéfin Weekly 📰\" subtitle \"$1\" sound name \"$3\"" 2>/dev/null
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send "The Pokéfin Weekly 📰" "$1 — $2" 2>/dev/null
  fi
}

if [ $STATUS -eq 0 ] && [ -n "$PDF" ] && [ -f "$PDF" ]; then
  NAME=$(basename "$PDF")
  echo "OK -> $NAME" >> "$LOG"

  # Delivery, not generation: the PDF on disk is the deliverable and already
  # exists by now, so a mail failure is logged and the run still counts as a
  # success. Exit 2 means email was never configured, which is not a problem
  # to report every week.
  MAIL_OUT=$("$PY" "$REPO/send_weekly_email.py" "$PDF" "$SUMMARY" 2>&1)
  MAIL_STATUS=$?
  echo "$MAIL_OUT" >> "$LOG"
  if [ $MAIL_STATUS -eq 1 ]; then
    notify "Report ready, email failed" "$NAME is in reports/ — see the log" "Basso"
  else
    notify "New investment report generated" "$NAME is ready in reports/" "Glass"
  fi
else
  echo "FAILED (status $STATUS, pdf='${PDF:-none}')" >> "$LOG"
  notify "Error" "Generation failed — see reports/weekly_report.log" "Basso"
fi

# launchd should see the failure too.
exit $STATUS
