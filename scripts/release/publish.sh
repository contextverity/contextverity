#!/usr/bin/env bash
# Publishes the tarballs in dist-packages/ to npm, in dependency order. Runs in
# GitHub Actions with npm trusted publishing (OIDC, no token); provenance is
# attached.
# Versions already on the registry are skipped, so a re-run is safe.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for f in "$ROOT"/dist-packages/*.tgz; do
  name="$(tar xzf "$f" -O package/package.json | node -pe 'JSON.parse(require("fs").readFileSync(0)).name')"
  version="$(tar xzf "$f" -O package/package.json | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')"
  if npm view "${name}@${version}" version >/dev/null 2>&1; then
    echo "skip ${name}@${version} (already published)"
    continue
  fi
  echo "publish ${name}@${version}"
  npm publish "$f" --access public --provenance
done
