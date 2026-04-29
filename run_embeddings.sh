ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtZ25yb3dxanJ4dmVzbWRzaG5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzkwMTAsImV4cCI6MjA5MDQ1NTAxMH0.XI1-XJtaTEu2rMBwmsUUGMUG3wWhnbiy-qW0Mx2c-zI"
BASE="https://hmgnrowqjrxvesmdshnp.supabase.co/functions/v1/embed-entity"

call_entity() {
  local id="$1"
  local type="$2"
  local resp
  resp=$(curl -s -X POST "$BASE" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$id\",\"entity_type\":\"$type\"}" \
    --max-time 120)
  local ok=$(echo "$resp" | grep -o '"ok":true' | head -1)
  local status=$(echo "$resp" | grep -o '"status":"[^"]*"' | head -1)
  if [ -n "$ok" ]; then
    echo "OK $type $id $status"
  else
    echo "ERR $type $id: $resp"
  fi
}

echo "=== Batch 1: looks 1-4 ==="
call_entity "08b81f84-1639-4f60-aa0d-d6e79ee6319a" "look" &
call_entity "1ea68300-5683-465c-9633-dc6e6c3e7941" "look" &
call_entity "21c643e6-5aab-4b1f-83e6-c6784e1384d6" "look" &
call_entity "2b129684-4cb5-4b0f-973e-7ace9d71fa56" "look" &
wait

echo "=== Batch 2: looks 5-8 ==="
call_entity "63792e4d-a9c0-4880-9f94-7844c8460935" "look" &
call_entity "864ca2a2-242f-4212-904c-dec6f5db5bc6" "look" &
call_entity "8aecb3e3-a5bb-43d6-b2f2-49688bd25e11" "look" &
call_entity "9b103730-b687-4f2a-a33b-2f8848e67cf5" "look" &
wait

echo "=== Batch 3: looks 9-12 ==="
call_entity "a7ce3b33-a4b7-4b3e-9e12-3deaffe35cc0" "look" &
call_entity "af2de0f1-dfc8-4fd2-bb24-c11ba6001d57" "look" &
call_entity "c486aa67-f575-44f1-ba34-fb1c2792f4c2" "look" &
call_entity "db51f7ca-4393-4e46-a3be-a0517af7adfe" "look" &
wait

echo "=== Batch 4: products 1-4 ==="
call_entity "a0000000-0000-0000-0000-000000000001" "product" &
call_entity "a0000000-0000-0000-0000-000000000002" "product" &
call_entity "a0000000-0000-0000-0000-000000000003" "product" &
call_entity "a0000000-0000-0000-0000-000000000004" "product" &
wait

echo "=== Batch 5: products 5-8 ==="
call_entity "a0000000-0000-0000-0000-000000000005" "product" &
call_entity "a0000000-0000-0000-0000-000000000006" "product" &
call_entity "a0000000-0000-0000-0000-000000000007" "product" &
call_entity "a0000000-0000-0000-0000-000000000008" "product" &
wait

echo "=== DONE ==="
