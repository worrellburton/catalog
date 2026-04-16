"""
CLI batch runner for video generation.

Usage:
    # Generate one product, specific style + AI model
    python run_batch.py --product-id <uuid> --style editorial_runway --ai-model-id <uuid>

    # Generate for all products missing videos (default style, auto-select model)
    python run_batch.py --all-products

    # Generate multiple styles for a brand
    python run_batch.py --brand "Wolfs Collections" --styles editorial_runway,street_style

    # Generate for a specific AI model
    python run_batch.py --ai-model-id <uuid> --all-products

    # Dry run — list products that would be processed
    python run_batch.py --all-products --dry-run
"""

import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()

from supabase import create_client


def main():
    parser = argparse.ArgumentParser(description="Video Generator batch runner")
    parser.add_argument("--product-id", help="Single product UUID")
    parser.add_argument("--all-products", action="store_true", help="Process all products without videos")
    parser.add_argument("--brand", help="Filter by brand name")
    parser.add_argument("--style", default="editorial_runway", help="Video style")
    parser.add_argument("--styles", help="Comma-separated list of styles")
    parser.add_argument("--ai-model-id", help="Specific AI model UUID")
    parser.add_argument("--dry-run", action="store_true", help="List products without generating")
    args = parser.parse_args()

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Determine which products to process
    products = []

    if args.product_id:
        row = supabase.table("products").select("id, name, brand, images").eq("id", args.product_id).single().execute()
        if row.data:
            products = [row.data]
        else:
            print(f"Product {args.product_id} not found")
            sys.exit(1)

    elif args.all_products:
        query = supabase.table("products").select("id, name, brand, images").eq("scrape_status", "done")
        if args.brand:
            query = query.eq("brand", args.brand)
        rows = query.execute()
        products = rows.data or []

        # Filter out products that already have generated videos
        if products:
            existing = supabase.table("generated_videos").select("product_id").in_(
                "product_id", [p["id"] for p in products]
            ).execute()
            existing_ids = {r["product_id"] for r in (existing.data or [])}
            products = [p for p in products if p["id"] not in existing_ids]

    else:
        print("Specify --product-id or --all-products")
        sys.exit(1)

    if not products:
        print("No products to process.")
        return

    # Determine styles
    styles = args.styles.split(",") if args.styles else [args.style]

    print(f"Products: {len(products)} | Styles: {styles} | AI Model: {args.ai_model_id or 'auto'}")
    print("─" * 60)

    for p in products:
        has_images = bool(p.get("images"))
        status = "ready" if has_images else "NO IMAGES"
        print(f"  [{status}] {p.get('name', 'Unknown')} ({p.get('brand', '—')}) — {p['id']}")

    if args.dry_run:
        print(f"\nDry run — {len(products)} product(s) would be processed.")
        return

    # Import agent and run
    from agent import generate_video

    total = len(products) * len(styles)
    done = 0
    failed = 0

    for product in products:
        if not product.get("images"):
            print(f"\n  Skipping {product.get('name', product['id'])} — no images")
            failed += 1
            continue

        for style in styles:
            try:
                print(f"\n  [{done + 1}/{total}] {product.get('name', 'Unknown')} — {style}")
                result = generate_video(
                    product_id=product["id"],
                    style=style,
                    ai_model_id=args.ai_model_id,
                )
                done += 1
                print(f"    look={result['look_id']}")
            except Exception as e:
                failed += 1
                print(f"    FAILED: {e}")

    print(f"\n{'─' * 60}")
    print(f"Done: {done} | Failed: {failed} | Total: {total}")


if __name__ == "__main__":
    main()
