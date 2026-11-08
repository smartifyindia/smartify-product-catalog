#!/bin/bash
# Uploads dist/whatsapp-images/*.jpg (from `node scripts/build-whatsapp-images.mjs`) to R2 smartify-images/whatsapp/.
# Same bucket and account as upload-to-r2.sh. Run it only when you intend to publish: the files become public.
set -u
ACCOUNT_ID="b9f8db8151b55e4e33b0190fd0805f38"
BUCKET="smartify-images"
PREFIX="whatsapp"
DIR="$(cd "$(dirname "$0")/.." && pwd)/dist/whatsapp-images"
[ -d "$DIR" ] || { echo "Run: node scripts/build-whatsapp-images.mjs first"; exit 1; }

count=0; failed=0
for img in "$DIR"/*.jpg; do
  name=$(basename "$img")
  if CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID npx wrangler r2 object put "$BUCKET/$PREFIX/$name" --file "$img" --content-type "image/jpeg" --remote 2>&1 | grep -q "Upload complete"; then
    echo "  ✓ $name"; count=$((count+1))
  else
    echo "  ✗ FAILED: $name"; failed=$((failed+1))
  fi
done
echo "Done: $count uploaded, $failed failed"
echo "Check with: node scripts/build-whatsapp-feed.mjs --verify-images"
[ "$failed" -eq 0 ]
