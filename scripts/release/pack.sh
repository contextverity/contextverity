#!/usr/bin/env bash
# Builds and packs the publishable packages into dist-packages/, then checks
# each tarball: dist entry points, resolved workspace ranges, version matches
# the tag (when RELEASE_TAG is set), license present, no local paths.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
YARN=(node "$ROOT/.yarn/releases/yarn-4.13.0.cjs")
OUT="$ROOT/dist-packages"
# Dependency order: each package's ContextVerity dependencies come first.
PACKAGES=(
  @contextverity/plugin-contextverity-common
  @contextverity/core
  @contextverity/plugin-contextverity-node
  @contextverity/plugin-contextverity-backend
  @contextverity/plugin-contextverity
)
rm -rf "$OUT" && mkdir -p "$OUT"
"${YARN[@]}" tsc
"${YARN[@]}" backstage-cli repo build
i=0
for p in "${PACKAGES[@]}"; do
  i=$((i + 1))
  "${YARN[@]}" workspace "$p" pack --out "$OUT/$(printf '%02d' $i)-%s-%v.tgz" >/dev/null
done
node - "$OUT" "${RELEASE_TAG:-}" <<'NODE'
const { execFileSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const [out, tag] = process.argv.slice(2);
let failed = false;
for (const f of readdirSync(out).filter(n => n.endsWith('.tgz')).sort()) {
  const file = `${out}/${f}`;
  const list = execFileSync('tar', ['tzf', file], { encoding: 'utf8' }).trim().split('\n');
  const pkg = JSON.parse(execFileSync('tar', ['xzf', file, '-O', 'package/package.json'], { encoding: 'utf8' }));
  const problems = [];
  if (!/^dist\//.test(pkg.main ?? '')) problems.push(`main is ${pkg.main}`);
  if (!/^dist\//.test(pkg.types ?? '')) problems.push(`types is ${pkg.types}`);
  if (!list.includes('package/LICENSE')) problems.push('LICENSE missing');
  for (const [k, v] of Object.entries(pkg.dependencies ?? {})) if (String(v).startsWith('workspace:')) problems.push(`${k} is ${v}`);
  if (tag && `v${pkg.version}` !== tag) problems.push(`version ${pkg.version} does not match tag ${tag}`);
  if (list.some(n => /\.test\.|__fixtures__|\/src\//.test(n))) problems.push('tests or sources included');
  const text = execFileSync('sh', ['-c', `tar xzf "${file}" -O | LC_ALL=C grep -aE "/Users/|/home/runner/" | head -1 || true`], { encoding: 'utf8' });
  if (text.trim()) problems.push('absolute local path found');
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${pkg.name}@${pkg.version} (${list.length} files)${problems.length ? ': ' + problems.join('; ') : ''}`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
NODE
