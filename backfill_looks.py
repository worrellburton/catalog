"""
Backfill text-lane embeddings for looks.

Calls embed-entity with entity_type='look' for every look that is live,
enabled, and missing a text_embedding. Mirrors backfill_creatives.py.

Flags:
  --force  Regenerate even if text_embedding already exists.
  --all    Include non-live / disabled looks.
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

def embed_one(look_id: str) -> tuple[str, bool, str]:
    r = subprocess.run([
        'curl', '-s', '-w', '\n__STATUS__%{http_code}',
        '-X', 'POST', EMBED_URL,
        '-H', f'Authorization: Bearer {SB_KEY}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'id': look_id, 'entity_type': 'look'}),
    ], capture_output=True, text=True, timeout=180)
    out = r.stdout
    body, status = (out.rsplit('__STATUS__', 1) + ['?'])[:2]
    status = status.strip()
    ok = status.startswith('2')
    msg = '' if ok else body[:150].strip()
    return look_id, ok, msg

# ── Fetch looks missing text_embedding ──────────────────────────────────────
print('Fetching looks to embed...')
force    = '--force' in sys.argv
all_rows = '--all'   in sys.argv

where_embed = '' if force else 'AND l.text_embedding IS NULL'

if all_rows:
    status_filter = ''
else:
    status_filter = "AND l.status = 'live' AND l.enabled = true"

rows = db_query(f"""
    SELECT l.id
    FROM looks l
    WHERE 1=1
      {status_filter}
      {where_embed}
    ORDER BY l.created_at DESC
""")

if isinstance(rows, dict) and 'message' in rows:
    print(f'DB error: {rows["message"]}')
    sys.exit(1)

ids = [r['id'] for r in rows]
total = len(ids)
flags = ' '.join(f for f in ['force' if force else '', 'all' if all_rows else ''] if f)
print(f'Found {total} looks to embed{(" (" + flags + ")") if flags else ""}\n')

if total == 0:
    print('Nothing to do.')
    sys.exit(0)

ok_count = fail_count = 0
start = time.time()

with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
    futures = {pool.submit(embed_one, lid): lid for lid in ids}
    done_n = 0
    for fut in as_completed(futures):
        lid, ok, msg = fut.result()
        done_n += 1
        if ok:
            ok_count += 1
            elapsed = time.time() - start
            rate = done_n / elapsed
            eta = (total - done_n) / rate if rate > 0 else 0
            print(f'  OK  [{done_n}/{total}] {lid[:8]}  (ETA {eta:.0f}s)')
        else:
            fail_count += 1
            print(f'  FAIL [{done_n}/{total}] {lid[:8]}: {msg}')

elapsed = time.time() - start
print(f'\n{"="*50}')
print(f'Done in {elapsed:.0f}s: {ok_count} OK, {fail_count} failed')
