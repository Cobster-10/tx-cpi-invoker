#!/bin/bash
# Sync changes from Cursor worktree to main project.
# Use this instead of "Apply worktree" when you get the EACCES path error.
#
# Run from project root: ./scripts/sync-from-worktree.sh

set -e
WORKTREE="${1:-$HOME/.cursor/worktrees/tx-cpi-invoker__WSL__Ubuntu_/zyq}"
MAIN="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -d "$WORKTREE" ]]; then
  echo "Worktree not found: $WORKTREE"
  exit 1
fi

echo "Copying from worktree to main (main-only files are kept)"
echo "From: $WORKTREE"
echo "To: $MAIN"

rsync -av \
  --exclude 'node_modules' \
  --exclude 'target' \
  --exclude '.git' \
  --exclude 'package-lock.json' \
  --exclude '.surfpool' \
  "$WORKTREE/" "$MAIN/"

echo "Done. Run: git status"
