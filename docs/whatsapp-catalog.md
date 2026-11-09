# WhatsApp catalog (Smartify official WABA number)

The catalog lives in Meta Commerce Manager. This repo produces the feed and the images; the Inbox Lambda sends the
product messages; the agent decides when to show them.

## 1. Build the feed and images

```bash
node scripts/build-whatsapp-images.mjs        # dist/whatsapp-images/<sku>.jpg, 1200 px, ~40 KB-300 KB each
node scripts/build-whatsapp-feed.mjs          # dist/whatsapp-catalog-feed.csv
```

What goes in: enabled products with an SRP and a real photo (47 of 47; Reach IR and Reach IR+ use their smartify.in photos via IMAGE_SOURCES).
Price is the SRP, which is GST-inclusive. `id` is the SKU, which is what an order message returns as `product_retailer_id`.
The build stops on a supplier name or "made to order" wording. Availability is always "in stock".

## 2. Publish the images (public R2, needs Abhi's go)

```bash
scripts/upload-whatsapp-images.sh                      # → smartify-images/whatsapp/<sku>.jpg
node scripts/build-whatsapp-feed.mjs --verify-images   # every image_link must answer 200 as JPEG/PNG under 8 MB
```

Meta rejects images over 8 MB. Seven repo masters are 12-21 MB PNGs, which is why the feed does not point at them.

## 3. Create the catalog and upload the feed (Meta UI, owner login)

1. business.facebook.com → Commerce Manager → Add catalog → **E-commerce**, owned by the same business portfolio as the WABA.
2. Catalog → Data sources → **Data feed** → upload `dist/whatsapp-catalog-feed.csv` (currency INR). Fix anything under Diagnostics.
3. Later: host the CSV at a stable URL and switch to a scheduled feed. A manual upload is enough to start.

## 4. Link the catalog to the WABA number

WhatsApp Manager → Phone numbers → the official number → Settings → **Commerce settings**: choose the catalog, turn on
"Catalog visibility" and "Cart". API equivalent (system-user token with whatsapp_business_management):

```bash
curl -X POST "https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/whatsapp_commerce_settings" \
  -H "Authorization: Bearer $TOKEN" -d "catalog_id=<CATALOG_ID>" -d "is_catalog_visible=true" -d "is_cart_enabled=true"
```

## 5. Turn it on in the backend (in this order, each needs Abhi's go)

1. Inbox Lambda: deploy the code (patch the live zip, never zip from source) and set `WHATSAPP_CATALOG_ID=<CATALOG_ID>`.
   Without the variable a product message is refused before anything is sent.
2. Shared layer + agent worker: deploy the new layer version. Everything is behind `AGENT_PRODUCT_CARDS_ENABLED`, default off.
3. Send one product card to the test number by hand, then set `AGENT_PRODUCT_CARDS_ENABLED=1` on the worker.
4. Order messages (cart sent from the catalog) arrive as `kind: "order"`. They need no flag: the Inbox stores them and the agent answers them.

## Rules that hold for this catalog

- Product cards show catalog prices, so the agent only sends them when it may quote a price (prices wait until the job is known).
- Customers never learn the manufacturer: re-run the OCR check on any new photo before it goes in the feed.
- A cart is not a payment. The agent follows up with the verified price and hands totals to the team.
