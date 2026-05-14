---
description: Promote dev to staging and main (fast-forward only), then push
---

Ship the current `dev` tip to production. Per CLAUDE.md §1, this is a fast-forward-only promotion — never rewrite history on shared branches.

Steps:

1. `git fetch origin dev staging main`
2. Confirm `origin/staging` and `origin/main` can fast-forward to `origin/dev`. If either has commits not on `dev`, STOP and surface the divergence — do not force-push or merge.
3. Update local refs:
   - `git update-ref refs/heads/staging origin/dev`
   - `git update-ref refs/heads/main origin/dev`
4. Push both: `git push origin staging:staging main:main`
5. Report the new `main` SHA and the Vercel production URL (`https://catalog.shop`).

Rules:
- Never use `--force` or `--force-with-lease`.
- If the working tree is on a `claude/*` branch, leave it there — only the remote refs change.
- If `dev` is behind `origin/dev`, fetch and use the remote tip; do not push local `dev` automatically.
