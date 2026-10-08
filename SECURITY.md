# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub Private Vulnerability
Reporting:

1. Open <https://github.com/contextverity/contextverity/security/advisories/new>
   (or the repository's **Security** tab → **Report a vulnerability**).
2. Describe the issue, affected versions or commits, and steps to reproduce.

Do not open a public issue for a suspected vulnerability. We aim to acknowledge
reports within 5 working days and to agree on a disclosure timeline with the
reporter. This is a small, volunteer-maintained project; timelines are best effort.

## Supported versions

ContextVerity is at v0.1 and has not had a stable release. Fixes are made on `main`.

## Scope

In scope: the packages in `plugins/` and their documented behavior — for example a
verification that returns `VALID` when the documented rules require `REFRESH` or
`DENY`, receipt integrity bypasses, consumer-binding bypasses, or context values
leaking into telemetry or to callers who are not authorized.

Out of scope: the demo-only lab in `packages/backend/src/lab` and `examples/`
(it deliberately exposes a control API and uses development-only guest sign-in),
and vulnerabilities in upstream projects (report those to the upstream project).

See [docs/security-model.md](docs/security-model.md) and
[docs/threat-model.md](docs/threat-model.md) for the trust model.
