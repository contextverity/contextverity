# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

### Added

- `@contextverity/core`: canonical JSON (RFC 8785 subset) and SHA-256 digests,
  context policy model with semantic policy digests, deterministic verdict engine
  with typed drift codes, receipt service, OpenTelemetry API instrumentation.
- `@contextverity/plugin-contextverity-node`: Backstage catalog source provider,
  Permission Framework authorizer, Knex receipt store with migrations.
- `@contextverity/plugin-contextverity-backend`: HTTP API (`/v1/resolve`,
  `/v1/receipts`, verify, inspect), file and inline policies, retention task,
  Actions Registry actions `resolve-context` and `verify-receipt`.
- `@contextverity/plugin-contextverity`: receipts list and receipt detail
  (provenance, permissions, drift, operator drift check).
- Backstage lab, 50 deterministic scenarios in two tiers, benchmarks, telemetry
  check, reference MCP client, generated results.
