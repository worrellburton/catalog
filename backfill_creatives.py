"""                                                                                            
Backfill text-lane embeddings for live product creatives.                                     
                                                                                               
Phase-2 search indexes product_creative directly via search_creatives_hybrid.                 
This script generates concept_doc + text_embedding for every live creative that               
does not yet have one by calling embed-entity with entity_type='creative'.                    
                                                                                               
Modeled on backfill_products.py (ThreadPoolExecutor, 5 parallel calls).                       
                                                                                               
Flags:                                                                                         
  --force  Regenerate even if text_embedding already exists.                                  
  --all    Include non-live / disabled creatives (status != 'live' OR enabled = false         
           OR video_url IS NULL OR product not active). Useful for warming the index          
           before rows go live.                                                                
"""
import json, subprocess, time, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0YXJqcm5xdmNxYmhvY2x2Y3VyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDgxMjM3OSwiZXhwIjoyMDkwMzg4Mzc5fQ.zOlXSSJssYObgOD7JlIVPWPWWVGEESThaX90utRs0l4'
PAT     = 'sbp_ada4545d7aa3e69d4fa196152b14c245a3938f2d'
SB_URL  = 'https://vtarjrnqvcqbhoclvcur.supabase.co'
API_URL = 'https://api.supabase.com/v1/projects/vtarjrnqvcqbhoclvcur/database/query'
EMBED_URL = f'{SB_URL}/functions/v1/embed-entity'
CONCURRENCY = 5

def db_query(sql: str) -> list:
    r = subprocess.run([
        'curl', '-s', '-X', 'POST', API_URL,
        '-H', f'Authorization: Bearer {PAT}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'query': sql}),
    ], capture_output=True, text=True, timeout=30)
    return json.loads(r.stdout)

def embed_one(creative_id: str) -> tuple[str, bool, str]:
    r = subprocess.run([
        'curl', '-s', '-w', '\n__STATUS__%{http_code}',
        '-X', 'POST', EMBED_URL,
        '-H', f'Authorization: Bearer {SB_KEY}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'id': creative_id, 'entity_type': 'creative'}),
    ], capture_output=True, text=True, timeout=180)
    out = r.stdout
    body, status = (out.rsplit('__STATUS__', 1) + ['?'])[:2]
    status = status.strip()
    ok = status.startswith('2')
    msg = '' if ok else body[:150].strip()
    return creative_id, ok, msg

print('Fetching unembedded live creatives...')
force    = '--force' in sys.argv
all_rows = '--all'   in sys.argv

where_text_embed = '' if force else 'AND pc.text_embedding IS NULL'

# --all: no status/enabled/active filters — embed every creative missing a vector.
# Default: live + enabled + has video + active product (matches what nl-search surfaces).
if all_rows:
    status_filter = ''
else:
    status_filter = """
      AND pc.status = 'live'
      AND pc.enabled = true
      AND pc.video_url IS NOT NULL
      AND p.is_active = true
    """

rows = db_query(f"""
    SELECT pc.id
    FROM product_creative pc
    JOIN products p ON p.id = pc.product_id
    WHERE 1=1
      {status_filter}
      {where_text_embed}
    ORDER BY pc.created_at DESC
""")

if isinstance(rows, dict) and 'message' in rows:
    print(f'DB error: {rows["message"]}')
    sys.exit(1)

ids = [r['id'] for r in rows]
total = len(ids)
flags = ' '.join(f for f in ['force' if force else '', 'all' if all_rows else ''] if f)
print(f'Found {total} creatives to embed{(" (" + flags + ")") if flags else ""}\n')

if total == 0:
    print('Nothing to do.')
    sys.exit(0)

ok_count = fail_count = 0
start = time.time()

with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
    futures = {pool.submit(embed_one, cid): cid for cid in ids}
    done_n = 0
    for fut in as_completed(futures):
        cid, ok, msg = fut.result()
        done_n += 1
        if ok:
            ok_count += 1
            elapsed = time.time() - start
            rate = done_n / elapsed
            eta = (total - done_n) / rate if rate > 0 else 0
            print(f'  OK  [{done_n}/{total}] {cid[:8]}  (ETA {eta:.0f}s)')
        else:
            fail_count += 1
            print(f'  FAIL [{done_n}/{total}] {cid[:8]}: {msg}')

elapsed = time.time() - start
print(f'\n{"="*50}')
print(f'Done in {elapsed:.0f}s: {ok_count} OK, {fail_count} failed')
