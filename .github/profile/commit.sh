#!/usr/bin/env bash
# Commit README/state changes made by a workflow and push, retrying if another run got there first.
set -euo pipefail
msg="$1"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A README.md .github/profile/data
if git diff --cached --quiet; then echo "Nothing to commit"; exit 0; fi
git commit -q -m "$msg"
remote="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
for i in 1 2 3 4 5; do
  if git pull -q --rebase "$remote" main && git push -q "$remote" HEAD:main; then echo "Pushed"; exit 0; fi
  sleep $((i * 3))
done
echo "Push failed after retries" >&2
exit 1
