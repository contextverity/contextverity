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

## npm setup (done for v0.1.0)

1. The npm organization `contextverity` owns the `@contextverity` scope; its owners
   have 2FA enabled.
2. Every package trusts `contextverity/contextverity` → `.github/workflows/release.yml`
   → environment `npm` (configured with `scripts/release/configure-trusted-publishing.sh`,
   which needs `npm login` and 2FA). New packages must be published once before they
   can be trusted; add them to the script afterwards.
3. No npm token is stored anywhere. v0.1.0 was published once with a short-lived token,
   which was then removed from GitHub and revoked.
4. Recommended: on each package's npm settings, set **Publishing access** to
   "Require two-factor authentication and disallow tokens". Trusted publishing keeps
   working; tokens cannot publish.
