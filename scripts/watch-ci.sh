#!/usr/bin/env bash
#
# watch-ci.sh — a single bounded CI poller. Replaces every ad-hoc watch
# improvisation (`gh run watch`, `timeout 480 …` [macOS has no timeout(1)],
# duplicate background watchers, `until grep` pollers).
#
# Usage:
#   scripts/watch-ci.sh branch <branch>   # follow the newest GH Actions run for <branch>
#   scripts/watch-ci.sh pr <number>       # poll `gh pr checks <number>` until all resolve
#
# Options:
#   --max-seconds N   overall ceiling (default 1800)
#   --interval N      seconds between polls (default 30)
#
# Behavior: pure polling loop with sleep — no `gh run watch`, no timeout(1),
# no GNU-isms; bash 3.2 / BSD-safe. Prints a line only on state change, plus a
# heartbeat every ~5 polls. Tolerates transient `gh` failures and a run that
# hasn't been created yet (grace period). Safe as a single background task.
#
# Exit codes:
#   0  success / all checks green
#   1  failure (prints which run/check failed)
#   2  timed out (prints last known state)
#   3  usage or prerequisite error (bad args, gh missing, no run found)

set -uo pipefail

usage() {
  echo "usage: scripts/watch-ci.sh (branch <branch> | pr <number>) [--max-seconds N] [--interval N]" >&2
  exit 3
}

MODE="${1:-}"; TARGET="${2:-}"
[ -n "$MODE" ] && [ -n "$TARGET" ] || usage
case "$MODE" in branch|pr) ;; *) usage ;; esac
shift 2

MAX_SECONDS=1800
INTERVAL=30
while [ $# -gt 0 ]; do
  case "$1" in
    --max-seconds) MAX_SECONDS="${2:-}"; shift 2 ;;
    --interval)    INTERVAL="${2:-}";    shift 2 ;;
    *) usage ;;
  esac
done
case "$MAX_SECONDS$INTERVAL" in *[!0-9]*) usage ;; esac
[ "$INTERVAL" -ge 1 ] || usage

command -v gh >/dev/null 2>&1 || { echo "error: gh CLI not found" >&2; exit 3; }

if [ "$MODE" = "pr" ]; then
  case "$TARGET" in *[!0-9]*) echo "error: pr target must be a PR number" >&2; exit 3 ;; esac
fi

START="$(date +%s)"
elapsed() { echo $(( $(date +%s) - START )); }

# Grace period for "the run doesn't exist yet" (e.g. push just happened):
# up to 120s (or MAX_SECONDS if smaller) of retries before giving up with 3.
GRACE=120
[ "$MAX_SECONDS" -lt "$GRACE" ] && GRACE="$MAX_SECONDS"

POLL=0
LAST_STATE=""
GH_FAILS=0

note_state() {  # print only on change; heartbeat every 5 polls
  local state="$1"
  if [ "$state" != "$LAST_STATE" ]; then
    echo "[watch-ci ${MODE}:${TARGET} +$(elapsed)s] $state"
    LAST_STATE="$state"
  elif [ $(( POLL % 5 )) -eq 0 ]; then
    echo "[watch-ci ${MODE}:${TARGET} +$(elapsed)s] still: $state"
  fi
}

timed_out() { [ "$(elapsed)" -ge "$MAX_SECONDS" ]; }

on_timeout() {
  echo "[watch-ci ${MODE}:${TARGET}] TIMED OUT after ${MAX_SECONDS}s — last known state: ${LAST_STATE:-unknown}"
  exit 2
}

# ---------------------------------------------------------------------------
if [ "$MODE" = "branch" ]; then
  # 1) Find the newest run for the branch (with grace-period retries).
  RUN_ID=""; RUN_URL=""
  while [ -z "$RUN_ID" ]; do
    LINE="$(gh run list --branch "$TARGET" --limit 1 \
              --json databaseId,url,workflowName \
              --jq '.[0] | "\(.databaseId)\t\(.url)\t\(.workflowName)"' 2>/dev/null || true)"
    if [ -n "$LINE" ] && [ "$LINE" != "null" ]; then
      RUN_ID="$(printf '%s' "$LINE" | cut -f1)"
      RUN_URL="$(printf '%s' "$LINE" | cut -f2)"
      WF_NAME="$(printf '%s' "$LINE" | cut -f3)"
      echo "[watch-ci branch:${TARGET}] watching run ${RUN_ID} (${WF_NAME}) ${RUN_URL}"
      break
    fi
    if [ "$(elapsed)" -ge "$GRACE" ]; then
      echo "error: no workflow run found for branch '${TARGET}' after ${GRACE}s." >&2
      echo "hint: check the branch name, or that a push actually triggered CI (gh run list --branch ${TARGET})." >&2
      exit 3
    fi
    sleep "$INTERVAL"
  done

  # 2) Poll that pinned run to completion.
  while :; do
    timed_out && on_timeout
    POLL=$(( POLL + 1 ))
    OUT="$(gh run view "$RUN_ID" --json status,conclusion \
             --jq '"\(.status)/\(.conclusion)"' 2>/dev/null || true)"
    if [ -z "$OUT" ]; then
      GH_FAILS=$(( GH_FAILS + 1 ))
      note_state "gh poll failed (${GH_FAILS}x) — retrying"
    else
      GH_FAILS=0
      STATUS="${OUT%%/*}"; CONCLUSION="${OUT##*/}"
      if [ "$STATUS" = "completed" ]; then
        if [ "$CONCLUSION" = "success" ]; then
          echo "[watch-ci branch:${TARGET} +$(elapsed)s] SUCCESS — run ${RUN_ID} ${RUN_URL}"
          exit 0
        else
          echo "[watch-ci branch:${TARGET} +$(elapsed)s] FAILED — run ${RUN_ID} concluded '${CONCLUSION}' ${RUN_URL}"
          exit 1
        fi
      fi
      note_state "status=${STATUS}"
    fi
    sleep "$INTERVAL"
  done
fi

# ---------------------------------------------------------------------------
if [ "$MODE" = "pr" ]; then
  while :; do
    timed_out && on_timeout
    POLL=$(( POLL + 1 ))
    # bucket ∈ pass | fail | pending | skipping | cancel
    COUNTS="$(gh pr checks "$TARGET" --json bucket --jq \
      '[.[].bucket] | "\(map(select(.=="pass"))|length) \(map(select(.=="fail" or .=="cancel"))|length) \(map(select(.=="pending"))|length) \(map(select(.=="skipping"))|length) \(length)"' \
      2>/dev/null || true)"
    if [ -z "$COUNTS" ]; then
      GH_FAILS=$(( GH_FAILS + 1 ))
      note_state "gh poll failed / no checks yet (${GH_FAILS}x) — retrying"
    else
      GH_FAILS=0
      read -r PASS BAD PEND SKIP TOTAL <<EOF
$COUNTS
EOF
      if [ "$TOTAL" -eq 0 ]; then
        if [ "$(elapsed)" -ge "$GRACE" ]; then
          echo "error: PR #${TARGET} has no checks after ${GRACE}s — is CI configured for it?" >&2
          exit 3
        fi
        note_state "no checks reported yet — waiting"
        sleep "$INTERVAL"
        continue
      fi
      if [ "$BAD" -gt 0 ]; then
        echo "[watch-ci pr:${TARGET} +$(elapsed)s] FAILED — ${BAD} check(s) failed/cancelled:"
        gh pr checks "$TARGET" --json name,bucket,link \
          --jq '.[] | select(.bucket=="fail" or .bucket=="cancel") | "  - \(.name) [\(.bucket)] \(.link)"' \
          2>/dev/null || true
        exit 1
      fi
      if [ "$PEND" -eq 0 ]; then
        echo "[watch-ci pr:${TARGET} +$(elapsed)s] ALL GREEN — pass:${PASS} skip:${SKIP}"
        exit 0
      fi
      note_state "pass:${PASS} pending:${PEND} skip:${SKIP}"
    fi
    sleep "$INTERVAL"
  done
fi

usage
