import sys, json, re

txt = sys.stdin.read()
m = re.search(r"Extracted Product Data:\n={10,}\n(\{.*)", txt, re.DOTALL)
if m:
    raw = m.group(1).strip()
    # trim anything after the closing brace of the top-level object
    depth, end = 0, 0
    for i, ch in enumerate(raw):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    data = json.loads(raw[:end])
    with open("test_google_shopping_result.json", "w") as f:
        json.dump(data, f, indent=2)
    print("Saved test_google_shopping_result.json")
    print(json.dumps(data, indent=2))
else:
    print("ERROR: no JSON found in output")
    print(txt[-1500:])
