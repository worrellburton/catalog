#!/usr/bin/env bash
# Restore FeedSection.tsx to its state before the director-based
# video playback was wired into the main feed.
#
# Usage:
#   bash scripts/restore-original-feed.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$SCRIPT_DIR/feed-backup/FeedSection.tsx"
TARGET="$SCRIPT_DIR/../app/components/FeedSection.tsx"

if [ ! -f "$BACKUP" ]; then
  echo "ERROR: backup not found at $BACKUP"
  exit 1
fi

cp "$BACKUP" "$TARGET"
echo "✓ Restored app/components/FeedSection.tsx from backup"
echo "  Restart the dev server to pick up the change."
