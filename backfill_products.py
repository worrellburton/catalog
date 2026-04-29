"""
Full backfill: embed all products with scrape_status='done' and no text_embedding.
Uses ThreadPoolExecutor for concurrency — embed-entity is slow (~3-5s per product
due to Claude Haiku + TwelveLabs calls), so we run 5 at a time.
"""
import json, subprocess, time, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0YXJqcm5xdmNxYmhvY2x2Y3VyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDgxMjM3OSwiZXhwIjoyMDkwMzg4Mzc5fQ.zOlXSSJssYObgOD7JlIVPWPWWVGEESThaX90utRs0l4'
PAT     = 'sbp_ada4545d7aa3e69d4fa196152b14c245a3938f2d'
SB_URL  = 'https://vtarjrnqvcqbhoclvcur.supabase.co'
API_URL = 'https://api.supabase.com/v1/projects/vtarjrnqvcqbhoclvcur/database/query'
EMBED_URL = f'{SB_URL}/functions/v1/embed-entity'
CONCURRENCY = 5  # parallel calls to embed-entity

def db_query(sql: str) -> list:
    r = subprocess.run([
        'curl', '-s', '-X', 'POST', API_URL,
        '-H', f'Authorization: Bearer {PAT}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'query': sql}),
    ], capture_output=True, text=True, timeout=30)
    return json.loads(r.stdout)

def embed_one(product_id: str) -> tuple[str, bool, str]:
    """Returns (product_id, success, message)."""
    r = subprocess.run([
        'curl', '-s', '-w', '\n__STATUS__%{http_code}',
        '-X', 'POST', EMBED_URL,
        '-H', f'Authorization: Bearer {SB_KEY}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'id': product_id, 'entity_type': 'product'}),
    ], capture_output=True, text=True, timeout=180)
    out = r.stdout
    body, status = (out.rsplit('__STATUS__', 1) + ['?'])[:2]
    status = status.strip()
    ok = status.startswith('2')
    msg = '' if ok else body[:150].strip()
    return product_id, ok, msg

# ── Fetch all unembedded done products ────────────────────────────────
print('Fetching unembedded products...')
rows = db_query("""
    SELECT id FROM products
    WHERE scrape_status = 'done'
      AND text_embedding IS NULL
      AND name IS NOT NULL
    ORDER BY scraped_at DESC NULLS LAST
""")

if isinstance(rows, dict) and 'message' in rows:
    print(f'DB error: {rows["message"]}')
    sys.exit(1)

ids = [r['id'] for r in rows]
total = len(ids)
print(f'Found {total} products to embed\n')

if total == 0:
    print('Nothing to do.')
    sys.exit(0)

ok_count = fail_count = 0
start = time.time()

with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
    futures = {pool.submit(embed_one, pid): pid for pid in ids}
    done_n = 0
    for fut in as_completed(futures):
        pid, ok, msg = fut.result()
        done_n += 1
        if ok:
            ok_count += 1
            elapsed = time.time() - start
            rate = done_n / elapsed
            eta = (total - done_n) / rate if rate > 0 else 0
            print(f'  OK  [{done_n}/{total}] {pid[:8]}  (ETA {eta:.0f}s)')
        else:
            fail_count += 1
            print(f'  FAIL [{done_n}/{total}] {pid[:8]}: {msg}')

elapsed = time.time() - start
print(f'\n{"="*50}')
print(f'Done in {elapsed:.0f}s: {ok_count} OK, {fail_count} failed')
