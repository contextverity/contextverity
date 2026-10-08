# Contributing to ContextVerity

Thank you for considering a contribution. ContextVerity is a young project; issues,
design discussion, documentation fixes and code are all welcome.

## Ground rules

- Be kind and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Keep the core deterministic. No language model, network service or randomness
  may influence a verdict.
- Every behavioral claim needs code, a test and, where it is measurable, a
  machine-generated result. Do not hand-edit `test-results/`, `docs/results.md` or
  the README results block — run `make test-results`.
- Do not overclaim in docs. Prefer "detects configured drift before receipt reuse"
  over "prevents stale context". Put future work in [ROADMAP.md](ROADMAP.md).
- New runtime dependencies need a reason and an entry in
  [DEPENDENCIES.md](DEPENDENCIES.md) (`node scripts/dependencies.mjs`).

## Getting started

```sh
make install
make verify          # format, lint, typecheck, unit + integration tests
make demo-up && make test-e2e   # scenarios against a live Backstage lab
```

Requirements: Node.js 22 or 24. See [docs/development.md](docs/development.md).

## Changing verdict behavior

Verdict rules are a public contract ([docs/context-verdicts.md](docs/context-verdicts.md)).
A change must:

1. update the engine (`plugins/contextverity-core/src/engine.ts`) and the docs;
2. add or change a scenario in `test/scenarios/src/scenarios.ts` with an exact
   expected verdict and drift-code set;
3. pass both tiers (`make test-integration` and `make test-e2e`); and
4. come with an ADR in `docs/adr/` if it changes semantics.

## Pull requests

- One logical change per PR, with tests.
- By contributing you agree that your contribution is licensed under the
  [Apache License 2.0](LICENSE).
- CI must pass. Maintainers review for correctness, scope and documentation.

## Reporting bugs

Open an issue with the version or commit, what you ran, what you expected and what
happened. Security issues go through [SECURITY.md](SECURITY.md), not issues.
