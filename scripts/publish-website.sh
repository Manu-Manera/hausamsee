#!/usr/bin/env bash
# Publiziert den aktuellen main-Stand ins öffentliche GitHub-Pages-Repo.
# Quelle der Wahrheit bleibt das private Repo (origin → haus-am-see).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git remote get-url website >/dev/null 2>&1; then
  echo "Remote 'website' fehlt. Erwartet: https://github.com/Manu-Manera/hausamsee.git"
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "Bitte auf branch main wechseln (aktuell: $branch)."
  exit 1
fi

echo "→ privates Repo (origin)…"
git push origin main

echo "→ öffentliche Website (website = hausamsee / GitHub Pages)…"
git push website main

echo "Fertig. Live: https://manu-manera.github.io/hausamsee/"
