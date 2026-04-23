"""
Generate the Smartify product catalog from CSV data and images.
Run: python3 generate_catalog.py
"""

import csv
import json
import os
from pathlib import Path
from urllib.parse import quote

BASE = Path(__file__).parent
CSV_PATH = Path("/Users/abhi/Downloads/Product_Photos/Product Glossary 31dcd4ab78e280899b7fce8d0ff31547_all.csv")
IMAGES_DIR = BASE / "images"

# Brand names to strip and replace with Smartify
BRAND_REPLACEMENTS = [
    ("Youtomatic", "Smartify"),
    ("youtomatic", "Smartify"),
    ("YOUTOMATIC", "SMARTIFY"),
    ("Aqara", "Smartify"),
    ("aqara", "Smartify"),
    ("AQARA", "SMARTIFY"),
]


def sanitize(text: str) -> str:
    """Replace third-party brand names with Smartify."""
    for old, new in BRAND_REPLACEMENTS:
        text = text.replace(old, new)
    return text

# Map product names (CSV) → list of image filenames (without extension) in images/
IMAGE_MAP = {
    # Retrofit Relays
    "1 Channel Zigbee Retrofit Relay":          ["Retrofit Relay"],
    "1 Channel Zigbee Retrofit Relay (40A)":    ["1 Channel Zigbee Retrofit Relay (40A)"],
    "2 Channel Zigbee Retrofit Relay":          ["Retrofit Relay"],
    "3 Channel Zigbee Retrofit Relay":          ["Retrofit Relay"],

    # Retrofit Dimmers
    "1 Channel Zigbee Retrofit Dimmer":         ["Retrofit Dimmer"],
    "2 Channel Zigbee Retrofit Dimmer":         ["Retrofit Dimmer"],

    # Other modules
    "Zigbee Shutter Module":                    ["Zigbee Shutter Module"],
    "Analog 0-10V Zigbee Dimmer":              ["Analog 0-10V Zigbee Dimmer"],

    # Gateways
    "Zigbee Gateway (Wired)":                   ["Zigbee Gateway (Wired)"],
    "Zigbee Gateway (Matter)":                  ["Zigbee Gateway (Matter)"],
    "Zigbee VRV Gateway":                       ["Zigbee VRV Gateway"],
    "Zigbee DALI Gateway":                      ["Zigbee DALI Gateway"],
    "Convergia":                                ["Convergia"],

    # IR Blasters
    "IR Blaster (WiFi)":                        [],
    "IR+RF Blaster (WiFi)":                     [],
    "IR Blaster w/ Analog Screen, Temp & Humidity Sensor (WiFi)": ["IR Blaster with Analog Screen"],

    # LED Controllers
    "LED Controller (CV-RGB+CCT)":              ["LED Controller (RGBW)"],
    "LED Controller (CV-DIMMER)":               ["LED Controller (CCT)"],
    "LED Controller (CC-CCT)":                  ["LED Controller (CCT)"],

    # Sensors
    "Zigbee Contact Sensor":                    ["Zigbee Contact Sensor"],
    "Zigbee Motion Sensor + LUX Sensor":        ["Zigbee Motion Sensor"],
    "Zigbee Vibration Sensor":                  ["Zigbee Vibration Sensor"],
    "Zigbee mmWave Sensor (USB)":              ["Zigbee mmWave Sensor (USB)"],
    "Zigbee mmWave Sensor (Ceiling Mounted)":   ["Zigbee mmWave Sensor (Ceiling Mounted)"],

    # TOQ Series
    "TOQ 4T":       ["TOQ - Grey", "TOQ - Black", "TOQ Overview"],
    "TOQ 4T+1S":    ["TOQ Fan Control with Socket - White"],
    "TOQ 8T":       ["TOQ - Grey", "TOQ - Black"],
    "TOQ 10T":      ["TOQ 10 Button Panel - Black", "TOQ Overview"],
    "TOQ 8T+1F":    ["TOQ Dual Fan Control with Socket - Black Gold"],
    "TOQ 4T+2F":    ["TOQ Fan Light Control with Socket - Black Gold"],
    "TOQ 8T+1S":    ["TOQ Fan Control with Socket - White"],
    "TOQ 4T+2F+1S": ["TOQ Fan Light Control with Socket - Black Gold"],
    "TOQ 10T+2S":   ["TOQ 10 Button Panel - Black"],

    # TAC Series
    "TAC 1":  ["TAC 1 Gang - White", "TAC 1 Gang - Grey", "TAC 1 Gang - Gold", "TAC Overview - White", "TAC Overview - Grey", "TAC Overview - Gold", "TAC D1 Series Overview"],
    "TAC 2":  ["TAC 2 Gang - White", "TAC 2 Gang - Grey", "TAC 2 Gang - Gold", "TAC Overview - White", "TAC Overview - Grey", "TAC Overview - Gold", "TAC D1 Series Overview"],
    "TAC 3":  ["TAC 3 Gang - White", "TAC 3 Gang - Grey", "TAC 3 Gang - Gold", "TAC Overview - White", "TAC Overview - Grey", "TAC Overview - Gold", "TAC D1 Series Overview"],
    "TAC 4":  ["TAC 4 Gang 6 Scene Switch - White", "TAC 4 Gang 6 Scene Switch - Grey", "TAC 4 Gang 6 Scene Switch - Gold"],
    "TAC 6":  ["TAC 6 Scene Switch - White", "TAC 6 Scene Switch - Grey", "TAC 6 Scene Switch - Gold"],
    "TAC 6+": ["TAC 4 Gang 6 Scene Switch - White", "TAC 4 Gang 6 Scene Switch - Grey", "TAC 4 Gang 6 Scene Switch - Gold"],
    "TAC HL": ["TAC Heavy Load Switch - White", "TAC Heavy Load Switch - Grey", "TAC Heavy Load Switch - Gold"],
    "TAC SH": ["TAC Curtain Switch - White", "TAC Curtain Switch - Grey", "TAC Curtain Switch - Gold"],
    "TAC SS": ["TAC Scene Switch with Remote - White", "TAC Scene Switch with Remote - Grey", "TAC Scene Switch with Remote - Gold"],
    "TAC S":  ["TAC Overview - White", "TAC Overview - Grey", "TAC Overview - Gold"],
    "TAC F":  ["TAC Fan Speed Controller"],
    "TAC K":  ["TAC Remote Control - Grey", "TAC Remote Control - Gold", "TAC Remote Control - Red", "TAC Remote Control - Green"],

    # Touch Panels
    '4" Touch Control Panel':   ["4 Inch Touch Control Panel"],
    '10" Touch Control Panel':  ["10 Inch Touch Control Panel"],

    # Others
    "4 Gang Scene Switch": ["TAC 4 Gang 6 Scene Switch - White", "TAC 4 Gang 6 Scene Switch - Grey", "TAC 4 Gang 6 Scene Switch - Gold"],
}


def slugify(name: str) -> str:
    return name.lower().replace(" ", "-").replace("/", "-").replace("+", "plus").replace('"', "").replace("'", "").replace("(", "").replace(")", "").replace("&", "and").replace(",", "").replace(".", "")


def parse_csv() -> list[dict]:
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def get_images_for_product(product_name: str) -> list[str]:
    names = IMAGE_MAP.get(product_name, [])
    result = []
    for name in names:
        path = IMAGES_DIR / f"{name}.png"
        if path.exists():
            result.append(f"{name}.png")
    return result


def build_product_json(row: dict) -> dict:
    """Build the combined product JSON from CSV row."""
    raw_json = {}
    try:
        raw_json = json.loads(row["JSON"])["product"]
    except Exception:
        pass

    images = get_images_for_product(row["Product Name"])
    hero = images[0] if images else ""

    return {
        "sku": row["Item Code"],
        "name": row["Product Name"],
        "slug": slugify(row["Product Name"]),
        "brand": "Smartify",
        "category": raw_json.get("CategoryName", []),
        "device_type": row["Device Type"],
        "protocol": row["Protocol"],
        "technology": raw_json.get("Technology", []),
        "assistants": raw_json.get("Assistants", []),
        "description": {
            "consumer": sanitize(row["Consumer Description"]),
            "technical": sanitize(row["Technical Description (Installer)"]),
        },
        "specs": {
            "summary": sanitize(row["Tech Specs"]),
            "channels": row["Channels"],
            "max_switching_capacity": row["Max Switching Capacity"],
            "recommended_load": row["Recommended Load"],
            "installation": sanitize(row["Installation"]),
            "compatibility": sanitize(row["Compatibility"]),
        },
        "pricing": {
            "srp_inr": int(raw_json["SRP"]) if raw_json.get("SRP") else None,
            "dealer_price_inr": int(raw_json["DP"]) if raw_json.get("DP") else None,
            "gst_rate": row["GST Rate %"],
            "hsn": row["HSN"],
        },
        "limitations": sanitize(row["Limitations / Exclusions"]),
        "dependencies": sanitize(row["Dependencies"]),
        "images": {
            "hero": f"../../images/{hero}" if hero else "",
            "all": [f"../../images/{img}" for img in images],
            "hero_url": f"../../images/{quote(hero)}" if hero else "",
            "all_urls": [f"../../images/{quote(img)}" for img in images],
        },
        "enabled": raw_json.get("enabled", True),
    }


def write_product_readme(product_dir: Path, data: dict, row: dict):
    images = data["images"]["all_urls"]
    hero_md = f'![{data["name"]}]({data["images"]["hero_url"]})\n\n' if data["images"]["hero_url"] else ""

    # Build image gallery
    gallery = ""
    if len(images) > 1:
        gallery = "### Gallery\n\n"
        for img in images:
            gallery += f'<img src="{img}" width="200" />\n'
        gallery += "\n"

    # Assistants
    assistants_str = " · ".join(data["assistants"]) if data["assistants"] else "—"

    # Specs table
    specs = data["specs"]
    specs_rows = []
    if specs.get("summary"):
        for part in specs["summary"].split("|"):
            part = part.strip()
            if ":" in part:
                k, v = part.split(":", 1)
                specs_rows.append(f"| {k.strip()} | {v.strip()} |")
    specs_table = "\n".join(specs_rows)

    # Pricing
    srp = data["pricing"].get("srp_inr")
    dp = data["pricing"].get("dealer_price_inr")
    pricing_section = ""
    if srp:
        pricing_section = f"""## Pricing

| | Price (INR) |
|---|---|
| Suggested Retail Price | ₹{srp:,} |
| Dealer Price | ₹{dp:,} |
| GST Rate | {data["pricing"]["gst_rate"]}% |
| HSN Code | {data["pricing"]["hsn"]} |

"""

    readme = f"""# {data["name"]}

{hero_md}{gallery}> {data["description"]["consumer"].splitlines()[0] if data["description"]["consumer"] else ""}

**SKU:** `{data["sku"]}` · **Protocol:** {data["protocol"]} · **Device Type:** {data["device_type"]}

---

## Description

{data["description"]["consumer"]}

---

## Technical Overview

{data["description"]["technical"]}

---

## Specifications

| Specification | Value |
|---|---|
{specs_table}

**Compatibility:** {specs.get("compatibility") or "—"}

**Voice Assistants:** {assistants_str}

---

{pricing_section}## Dependencies

{data["dependencies"] or "None"}

## Limitations

{data["limitations"] or "None"}

---

[← Back to catalog](../../README.md)
"""
    (product_dir / "README.md").write_text(readme.strip() + "\n")


def build_catalog():
    rows = parse_csv()
    all_products = []
    products_dir = BASE / "products"
    products_dir.mkdir(exist_ok=True)

    for row in rows:
        slug = slugify(row["Product Name"])
        product_dir = products_dir / slug
        product_dir.mkdir(exist_ok=True)

        data = build_product_json(row)
        all_products.append(data)

        # Write product.json
        (product_dir / "product.json").write_text(json.dumps(data, indent=2) + "\n")

        # Write README.md
        write_product_readme(product_dir, data, row)

    # Write combined products.json
    (BASE / "products.json").write_text(json.dumps(all_products, indent=2) + "\n")

    return all_products


def write_main_readme(all_products: list[dict]):
    # Group by category
    categories = {}
    for p in all_products:
        cats = p["category"] if p["category"] else ["Other"]
        for cat in cats[:1]:  # use first category
            categories.setdefault(cat, []).append(p)

    # Build table of products
    table_rows = []
    for p in all_products:
        images_root = [img.replace("../../images/", "images/") for img in p["images"]["all_urls"]]
        thumb = f'<img src="{images_root[0]}" width="60" />' if images_root else "—"
        desc_first_line = p["description"]["consumer"].splitlines()[0] if p["description"]["consumer"] else ""
        table_rows.append(
            f'| {thumb} | [{p["name"]}](products/{p["slug"]}/README.md) | {p["protocol"]} | {desc_first_line[:60]}{"..." if len(desc_first_line) > 60 else ""} |'
        )

    table = "\n".join(table_rows)

    readme = f"""# Smartify Product Catalog

> The complete Smartify smart home product lineup — technical specs, pricing, images, and integration details for every device.

## Products ({len(all_products)} total)

| | Product | Protocol | Description |
|---|---|---|---|
{table}

---

## Repository Structure

```
smartify-product-catalog/
├── README.md              # This file — full product index
├── products.json          # All products as a single JSON array
├── images/                # All product images (60 files)
└── products/              # One folder per product
    └── <product-slug>/
        ├── README.md      # Product page with specs and images
        └── product.json   # Machine-readable product data
```

## Data Sources

- **CSV:** Product Glossary with specs, pricing, descriptions, and tech data
- **Images:** Clean product photos
- **DynamoDB:** Synced with Smartify Pro product catalog

---

*Generated from Product Glossary · {len(all_products)} products · 60 images*
"""
    (BASE / "README.md").write_text(readme.strip() + "\n")


if __name__ == "__main__":
    print("Building catalog...")
    all_products = build_catalog()
    write_main_readme(all_products)
    print(f"Done. Generated {len(all_products)} product pages.")
    print(f"  → products/ ({len(all_products)} folders)")
    print(f"  → products.json")
    print(f"  → README.md")
