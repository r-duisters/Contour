#!/bin/sh
# Wake the alert evaluator on a schedule.
#
# A loop rather than cron: it logs every tick to stdout where `docker logs`
# finds it, it needs no daemon, and a failure is visible instead of landing in
# a mail spool nobody reads. The app has never delivered an alert, and the way
# that happened was silence nobody could see.
set -u

: "${CONTOUR_URL:?CONTOUR_URL is required}"
: "${CRON_SECRET:?CRON_SECRET is required — the evaluator refuses without it}"
INTERVAL="${INTERVAL_SECONDS:-900}"

echo "[alerts] every ${INTERVAL}s against ${CONTOUR_URL}"

while :; do
  started=$(date -u +%H:%M:%S)
  body=$(curl -sS --max-time 60 -w '\n%{http_code}' \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "${CONTOUR_URL}/api/cron/evaluate" 2>&1)
  code=$(printf '%s' "$body" | tail -n1)
  json=$(printf '%s' "$body" | sed '$d')

  if [ "$code" = "200" ]; then
    # `ok: true` is not success — the route answers that whether or not
    # anything was priced. Report what actually fired.
    fired=$(printf '%s' "$json" | grep -o '"fired":[0-9]*' | cut -d: -f2 | paste -sd+ - | bc 2>/dev/null || echo "?")
    errs=$(printf '%s' "$json" | grep -o '"error":"[^"]*"' | head -3)
    echo "[alerts] ${started} ok  fired=${fired:-0} ${errs}"
  else
    echo "[alerts] ${started} FAILED http=${code} ${json}"
  fi

  sleep "$INTERVAL"
done
