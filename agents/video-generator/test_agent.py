"""
Local test for the video generator agent.

Usage:
    python test_agent.py

Tests against a real Supabase product (requires .env with valid credentials).
"""

import os
import json
import sys

from dotenv import load_dotenv

load_dotenv()

from supabase import create_client


def test_generate_video():
    """End-to-end test: pick a scraped product and generate a video."""
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Find a product with images (scrape_status=done)
    rows = supabase.table("products").select("id, name, brand, images").eq("scrape_status", "done").limit(1).execute()

    if not rows.data:
        print("No scraped products found. Scrape a product first.")
        sys.exit(1)

    product = rows.data[0]
    print(f"Test product: {product.get('name')} ({product['id']})")
    print(f"  Images: {len(product.get('images', []))}")

    # Find an active AI model (or skip)
    model_rows = supabase.table("ai_models").select("id, name").eq("status", "active").limit(1).execute()
    ai_model_id = model_rows.data[0]["id"] if model_rows.data else None

    if ai_model_id:
        print(f"  AI Model: {model_rows.data[0]['name']} ({ai_model_id})")
    else:
        print("  AI Model: none (using defaults)")

    # Run the agent
    from agent import generate_video

    result = generate_video(
        product_id=product["id"],
        style="editorial_runway",
        ai_model_id=ai_model_id,
    )

    print(f"\nResult:")
    print(json.dumps(result, indent=2))

    # Verify records
    look = supabase.table("looks").select("*").eq("id", result["look_id"]).single().execute()
    print(f"\nLook record: status={look.data['status']}, title={look.data['title']}")

    videos = supabase.table("look_videos").select("*").eq("look_id", result["look_id"]).execute()
    print(f"Look videos: {len(videos.data)} video(s)")

    products_linked = supabase.table("look_products").select("*").eq("look_id", result["look_id"]).execute()
    print(f"Look products: {len(products_linked.data)} product(s)")

    job = supabase.table("generated_videos").select("*").eq("id", result["job_id"]).single().execute()
    print(f"Generated video: status={job.data['status']}, cost=${job.data.get('cost_usd', '?')}")

    # Save test results
    with open("test_results.json", "w") as f:
        json.dump({
            "product": product,
            "ai_model_id": ai_model_id,
            "result": result,
            "look": look.data,
            "job": job.data,
        }, f, indent=2, default=str)

    print("\nTest results saved to test_results.json")


if __name__ == "__main__":
    test_generate_video()
