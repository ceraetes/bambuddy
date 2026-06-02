#!/usr/bin/env bash
# Merge origin/dev + integration branches for the fork dev image build.
set -euo pipefail

INTEGRATION_FILE="${INTEGRATION_FILE:-.github/integration-branches}"

branch_from_line() {
  echo "$1" | awk '{print $1}'
}

list_branches() {
  while IFS= read -r line; do
    branch_from_line "$line"
  done < <(grep -v '^\s*#' "$INTEGRATION_FILE" | grep -v '^\s*$')
}

# Merge one branch; auto-resolve prebuilt static/ from the feature branch only.
merge_branch() {
  local b="$1"
  echo "Merging origin/$b ..."
  set +e
  git merge "origin/$b" --no-edit
  local merge_rc=$?
  set -e

  if [ "$merge_rc" -ne 0 ]; then
    local non_static
    non_static=$(git diff --name-only --diff-filter=U | grep -v '^static/' || true)
    if [ -n "$non_static" ]; then
      echo "ERROR: merge conflict outside static/ (cannot auto-resolve):"
      echo "$non_static"
      git diff --name-only --diff-filter=U > /tmp/conflict-files.txt || true
      git merge --abort 2>/dev/null || true
      return 1
    fi
    echo "Resolving static/ conflicts using origin/$b ..."
    git checkout "origin/$b" -- static/
    git add static/
    if git diff --name-only --diff-filter=U | grep -q .; then
      git diff --name-only --diff-filter=U > /tmp/conflict-files.txt || true
      git merge --abort 2>/dev/null || true
      return 1
    fi
    git commit --no-edit
    return 0
  fi

  return 0
}

git checkout -B integration-build origin/dev

while IFS= read -r b; do
  [ -n "$b" ] || continue
  merge_branch "$b" || exit 1
done < <(list_branches)

echo "sha=$(git rev-parse HEAD)"
