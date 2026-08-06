#!/bin/bash
# Upload all product catalog images to R2 smartify-images/products/

ACCOUNT_ID="b9f8db8151b55e4e33b0190fd0805f38"
BUCKET="smartify-images"
PREFIX="products"
IMAGES_DIR="$(dirname "$0")/images"

echo "Uploading product images to R2..."
count=0
failed=0

for img in "$IMAGES_DIR"/*.png; do
  filename=$(basename "$img")
  key="$PREFIX/$filename"

  result=$(CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID wrangler r2 object put "$BUCKET/$key" \
    --file "$img" \
    --content-type "image/png" \
    --remote 2>&1)

  if echo "$result" | grep -q "Upload complete"; then
    echo "  ✓ $filename"
    ((count++))
  else
    echo "  ✗ FAILED: $filename"
    echo "    $result"
    ((failed++))
  fi
done

echo ""
echo "Done: $count uploaded, $failed failed"
echo "Public URL: https://pub-cb5e9b79d39046829fc7d2bc4443b347.r2.dev/$PREFIX/"
