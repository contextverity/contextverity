# ADR 0006: MCP integration boundaries

**Status:** accepted (2026-10-08)

## Context

Backstage already provides the Actions Registry and an official MCP Actions backend.
We checked whether the Actions Registry offers middleware or hooks for gating other
plugins' actions: it does not. The only levers are config filters, a per-action
`visibilityPermission` set by the owning plugin, or replacing the actions service
factory (unsupported; direct HTTP calls would bypass it anyway).

## Decision

- Do not build an MCP server or wrap the MCP backend.
- Register `contextverity:resolve-context` and `contextverity:verify-receipt` in the
  Actions Registry; the official MCP backend exposes them as tools.
- The integration is **explicit and advisory**: an agent resolves context, verifies
  the receipt before acting, and acts only on VALID. `scripts/demo/mcp-client.ts` is the
  reference.
- Do not claim global enforcement.

## Findings

- User tokens keep their identity through the MCP backend.
- Static-token service callers are forwarded to actions as `plugin:mcp-actions`, so
  per-agent binding is not possible on that path; default policies refuse it.
- With HTTP instrumentation, ContextVerity spans nest under the MCP backend's
  `tools/call` span.
