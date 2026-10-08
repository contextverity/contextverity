# Releasing

Five packages are published to npm under the `@contextverity` scope, all with the
same version:

| Package                                       | Backstage role  |
| --------------------------------------------- | --------------- |
| `@contextverity/plugin-contextverity-common`  | common library  |
| `@contextverity/core`                         | node library    |
| `@contextverity/plugin-contextverity-node`    | node library    |
| `@contextverity/plugin-contextverity-backend` | backend plugin  |
| `@contextverity/plugin-contextverity`         | frontend plugin |

`@contextverity/scenarios` and the demo app are private and never published.

## How a release works

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`:

1. install, type check and test;
2. `scripts/release/pack.sh` builds every package and packs it with `yarn pack`
   (which resolves `workspace:` ranges and runs Backstage's prepack), then checks each
   tarball: `dist/` entry points, license present, no tests or sources, no absolute
   local paths, version equal to the tag;
3. `scripts/release/publish.sh` publishes the tarballs in dependency order with
   provenance, skipping versions that already exist (safe to re-run).

Publishing uses **npm trusted publishing** (GitHub OIDC, `id-token: write`); no
long-lived npm token is stored. CI runs `scripts/release/pack.sh` on every push, so a
broken package fails before a release is attempted.

## Steps for a release

1. Make sure `main` is green (`make verify`, `make test-e2e`, `make k8s-test`).
2. Bump all five package versions together, update `CHANGELOG.md`, regenerate results
   (`make test-results`) and commit.
3. Tag with a signed tag and push: `git tag -s vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
4. Watch the Release workflow; verify on npm that each version shows provenance.

## One-time npm setup

1. An npm organization named `contextverity` owns the `@contextverity` scope.
2. Trusted publishing is configured for each package — either run
   `npm login && scripts/release/configure-trusted-publishing.sh` (npm ≥ 11.15, 2FA
   approval in the browser), or set it on npmjs.com (package →
   Settings → Trusted publisher → GitHub Actions): organization `contextverity`,
   repository `contextverity`, workflow `release.yml`, environment `npm`.
3. npm only offers that setting once a package exists. For the first release only, an
   npm granular access token with publish rights for `@contextverity` can be stored as
   the repository secret `NPM_TOKEN`; the workflow uses it if present (provenance is
   still attached). After the first release, configure trusted publishing for every
   package, delete the secret, and revoke the token.
