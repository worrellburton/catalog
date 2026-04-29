import subprocess, json, time

ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0YXJqcm5xdmNxYmhvY2x2Y3VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTIzNzksImV4cCI6MjA5MDM4ODM3OX0.OMoLmVDtXLw5hL0k7icaBJlIbLPnN9UeCzv8C-o4III'
BASE = 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-entity'

LOOK_IDS = [
    '39c2ec3a-eeb1-4076-9405-458025d78dc4','0fae2d41-3af5-4eeb-ab1a-b94c4d0cc3a9',
    'e787e355-f59c-4740-91c1-be6141fd9b1c','2ec8dd8e-4d83-4a5f-9e6c-d765daf264cc',
    'a4e4be3b-79d3-45dd-b0e0-dbf8b8017619','a6e97bd3-f379-432d-830c-24f28e4631f9',
    'b12290a4-3be7-42aa-a66d-e1b21d90f459','d561f132-1704-4266-8492-73cda63670a9',
    'ba0a3b9f-6d12-40ee-a31d-94bc84300975','bf6709e7-6c12-4a8a-a3a9-e95e437075b6',
    'd1e3475a-5899-4afc-8f18-fb4f3e733708','ffc21705-b7c3-41d2-931d-dd3463ada33e',
]

PRODUCT_IDS = [
    '4a04cc12-3cce-44bb-a831-a613d366af11','5f2fb295-36f3-4886-8f1a-6cb9c1627b71',
    '999d7448-e09b-4c24-b7fa-105c4d1461cf','abd35849-df72-4758-b23d-8a44704ad7f5',
    '9b96a7e4-fd89-41e7-ae49-8e949788837d','bab90bab-adae-4bab-98e3-e49da00217ce',
    'b3dba371-12aa-42c4-ad6e-bee05c47563d','e6a61349-ab89-4186-abc9-161d38b3d952',
    'e9511150-02f4-4a21-89db-344d7f68f1b5','20f0f590-10ef-4893-914e-42907a98803e',
    'e927a1bb-adb2-4d1f-85e4-435f7e11920c','9389292e-7fd0-44b9-811d-9d59d0bddb90',
    '0cd19bd2-f606-4cef-8537-348b7f451fc7','6c8de830-62ed-4f20-8ac8-ab40ec105f28',
    '49552949-b2ea-4949-8bc1-7dfcce1b6fda','4d8f8dee-a41f-4f86-a291-1cdf721fda39',
    '35ddfead-fe62-4946-a0dd-8c5392bdface','a90a9dba-7ab5-40a8-98ec-37ff719ed280',
    '9207f003-ce2f-4eed-9748-ee6731966a43','6e251bd5-17e1-4172-a97f-fd2f395c0362',
]

entities = [('look', i) for i in LOOK_IDS] + [('product', i) for i in PRODUCT_IDS]
print(f'Backfilling {len(entities)} entities...\n')
ok = fail = 0

for entity_type, entity_id in entities:
    r = subprocess.run([
        'curl', '-s', '-w', '\n__STATUS__%{http_code}',
        '-X', 'POST', BASE,
        '-H', f'Authorization: Bearer {ANON_KEY}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'id': entity_id, 'entity_type': entity_type}),
    ], capture_output=True, text=True, timeout=120)
    out = r.stdout
    body, status = (out.rsplit('__STATUS__', 1) + ['?'])[:2]
    status = status.strip()
    if status.startswith('2'):
        print(f'  OK ({status}) {entity_type} {entity_id[:8]}')
        ok += 1
    else:
        print(f'  FAIL ({status}) {entity_type} {entity_id[:8]}: {body[:200]}')
        fail += 1
    time.sleep(0.3)

print(f'\nDone: {ok} OK, {fail} failed')
