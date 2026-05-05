# Tests

This folder contains all test scripts for the catalog search functionality.

## Test Scripts

### Search Tests
- **test-search-cli.mjs** - CLI tool for interactive search testing with JSON output
- **test-baseline-search.mjs** - Baseline search quality tests
- **test-contextual-search.mjs** - Tests for contextual queries (occasions, activities)
- **test-enriched-search.mjs** - Validation tests for AI-enriched product descriptions

### Smoke Tests
- **smoke-test-v3.mjs** - Comprehensive smoke tests for Search V3
- **smoke-test-active-products.mjs** - Tests on active products only

### Enrichment Tests
- **test-description-enrichment.mjs** - Tests for AI description enrichment
- **update-test-products.mjs** - Script to update test products with enriched descriptions

## Usage

### Run Search CLI
```bash
# From project root
node tests/test-search-cli.mjs "casual friday" --verbose
node tests/test-search-cli.mjs "gym workout" --output ../test-results/gym.json
```

### Run Contextual Tests
```bash
# From project root
set -a && source .env && set +a && node tests/test-enriched-search.mjs
```

### Run Smoke Tests
```bash
# From project root
set -a && source .env && set +a && node tests/smoke-test-v3.mjs
```

## Output

All test results are saved to `../test-results/` by default.

## Dependencies

Tests require:
- `.env` file with Supabase credentials
- `@supabase/supabase-js` package
- Active Supabase project with Search V3 migrations applied
