# Search CLI Tool

Quick reference for `test-search-cli.mjs` — test search queries from command line and save results to JSON.

## Basic Usage

```bash
# Set up environment and run
set -a && source .env && set +a && node test-search-cli.mjs "keyword"
```

## Options

| Option | Description | Example |
|---|---|---|
| `<keyword>` | Search query (required) | `"yoga"`, `"black dress"` |
| `-o, --output FILE` | Save to JSON file | `--output results.json` |
| `-k NUMBER` | Number of results | `--k 20` (default: 24) |
| `--gender TEXT` | Filter by gender | `--gender female` |
| `--verbose` | Show detailed output | `--verbose` |

## Examples

```bash
# Simple search
node test-search-cli.mjs "yoga"

# With custom output file
node test-search-cli.mjs "casual friday" --output friday.json

# With gender filter and more results
node test-search-cli.mjs "black dress" --gender female --k 50

# Verbose mode (shows all product details)
node test-search-cli.mjs "gym workout" --verbose

# Combine all options
node test-search-cli.mjs "summer vacation" --output summer.json --k 30 --gender female --verbose
```

## Output Format

Results are saved to JSON with this structure:

```json
{
  "meta": {
    "query": "yoga",
    "timestamp": "2026-05-05T12:34:56.789Z",
    "k": 24,
    "gender": null,
    "elapsed_ms": 1883,
    "server_ms": 867,
    "result_count": 11
  },
  "results": [
    {
      "product_id": "uuid",
      "product_name": "Game Time Short",
      "product_brand": "Alo Yoga",
      "product_price": "$78.00",
      "product_type": "Shorts",
      "product_gender": "female",
      "product_url": "https://...",
      "product_image_url": "https://...",
      "score": 0.0318,
      "has_video": true,
      "creative_id": "uuid",
      "video_url": "https://...",
      "thumbnail_url": "https://...",
      "is_elite": false
    }
  ]
}
```

## Terminal Output

The script shows:
- ✅ Search status and timing
- 📊 Top 5 results (or top 10 in verbose mode)
- 💾 JSON file location
- 📈 Summary stats (total, video coverage, avg score)
- 🏷️ Top 5 brands by product count
- 👕 Top 5 product types

## Use Cases

1. **Quick search testing**: Test specific keywords and see results instantly
2. **QA validation**: Save results to JSON for comparison before/after changes
3. **Data exploration**: Use `--verbose` to inspect product details
4. **Gender-specific searches**: Test women's vs men's product results
5. **Batch testing**: Run multiple queries and save each to separate JSON files

## Tips

- Use quotes around multi-word queries: `"casual friday"` not `casual friday`
- Results are sorted by relevance score (highest first)
- Default output file is `search-results.json` (gets overwritten each run)
- Use `--output` to save multiple test results: `yoga.json`, `gym.json`, etc.
- Verbose mode is useful for debugging but can be very long for many results
