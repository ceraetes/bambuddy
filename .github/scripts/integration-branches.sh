#!/usr/bin/env bash
# Parse .github/integration-branches and support merge-order checks.
set -euo pipefail

INTEGRATION_FILE="${INTEGRATION_FILE:-.github/integration-branches}"

branch_from_line() {
  echo "$1" | awk '{print $1}'
}

after_from_line() {
  echo "$1" | awk '{
    for (i = 2; i <= NF; i++) {
      if ($i == "after" && i < NF) { print $(i + 1); exit }
    }
  }'
}

# Print branch names in merge order (first field per non-comment line).
list_branches() {
  while IFS= read -r line; do
    branch_from_line "$line"
  done < <(grep -v '^\s*#' "$INTEGRATION_FILE" | grep -v '^\s*$')
}

# dev_sha,branch=sha,... fingerprint for change detection.
fingerprint() {
  git fetch origin dev
  fp="dev=$(git rev-parse origin/dev)"
  while IFS= read -r branch; do
    [ -n "$branch" ] || continue
    git fetch origin "$branch"
    fp="${fp},${branch}=$(git rev-parse "origin/${branch}")"
  done < <(list_branches)
  echo "$fp"
}

# Ensure "after" references appear earlier in the file (merge order is file order).
validate_merge_order() {
  local -a seen=()
  while IFS= read -r line; do
    branch=$(branch_from_line "$line")
    after=$(after_from_line "$line")
    if [ -n "$after" ]; then
      local found=false
      for s in "${seen[@]}"; do
        if [ "$s" = "$after" ]; then
          found=true
          break
        fi
      done
      if [ "$found" != true ]; then
        echo "ERROR: $branch lists 'after $after' but $after is not above it in integration-branches"
        return 1
      fi
    fi
    seen+=("$branch")
  done < <(grep -v '^\s*#' "$INTEGRATION_FILE" | grep -v '^\s*$')
}

case "${1:-}" in
  list) list_branches ;;
  fingerprint) fingerprint ;;
  validate) validate_merge_order ;;
  *)
    echo "Usage: $0 list|fingerprint|validate" >&2
    exit 2
    ;;
esac
