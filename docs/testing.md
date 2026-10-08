# Testing

Tests are part of the product: every behavioral claim maps to code, a test and,
where measurable, a machine-generated result in `test-results/`.

## Layers

| Layer       | Command                 | What                                                                                                                                                                                                                        |
| ----------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `make test-unit`        | canonicalization (incl. RFC 8785 vectors), integrity tags and downgrade protection, policy validation and digests, telemetry (spans, bounded metrics, no context values), Backstage normalization rules, frontend rendering |
| Integration | `make test-integration` | the backend plugin on a real Backstage test backend (`startTestBackend`, SQLite) with mocked catalog and permissions; all 50 scenarios in the **core tier**                                                                 |
| End to end  | `make test-e2e`         | all scenarios against the **live lab** (`make demo-up`)                                                                                                                                                                     |
| Results     | `make test-results`     | regenerates scenario, benchmark and telemetry JSON plus `docs/results.md`                                                                                                                                                   |

## Scenario tiers

Scenarios are defined once (`test/scenarios/src/scenarios.ts`) and run through a
`Harness` interface:

- **core** — in-process: the real engine, the real Backstage provider mapping and the
  real Knex/SQLite store, against a synthetic catalog that emulates Backstage relation
  stitching and UID assignment. Controllable clock; outages, restarts and a second
  issuer can be simulated.
- **backstage** — a live Backstage backend over HTTP. World changes go through the
  lab's entity provider and permission policy and are awaited until the real catalog
  reflects them (about 1–2 s each). Scenarios needing a controllable clock, catalog
  outage, process restart or second issuer are reported as **N/A** in this tier, not
  faked.

Each scenario declares the expected verdict (or resolve refusal code), the exact set
of drift codes with a REFRESH/DENY effect, required informational codes, and extra
checks. A scenario passes only if all match.

The tiers cross-check each other: the core tier's catalog emulation must produce the
same outcomes as the real catalog.

## Metrics

Over executed scenarios:

- **Stale-context detection rate** = scenarios expected REFRESH or DENY that were not
  VALID, divided by scenarios expected REFRESH or DENY.
- **False invalidation rate** = scenarios expected VALID (nothing relevant changed, or
  changed only in categories the policy does not require fresh) that were not VALID,
  divided by scenarios expected VALID.
- **False acceptance rate** = expected REFRESH or DENY but observed VALID.
- **DENY / REFRESH correctness** = expected DENY (REFRESH) observed as exactly DENY
  (REFRESH).
- **Resolve refusal correctness** = expected refusals observed with the exact code.

These are computed over a small, hand-designed synthetic set. They show that the
documented rules are implemented, not that error rates generalize.

## Guarding the tests

A quick mutation check is part of development practice: for example, disabling set
sorting in `canonicalSet` makes exactly S33 (relation order) fail.

## Benchmarks

`scripts/benchmark.ts`. Core tier: 2,000 samples per row after 200 warm-up calls,
p99 reported (≥1,000 samples). Live tier: 300 samples, p99 omitted. Core and live
numbers are separate files and are never combined. Hardware is recorded in each file.
