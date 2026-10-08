# Limitations

ContextVerity is more useful when it is clear about what it does not do. Each item
below applies to v0.1 as implemented.

1. **Verification is point-in-time.** `VALID` means the context matched at
   verification time. Something can change between verify and act (TOCTOU). Scenario
   S40 characterizes this; ContextVerity does not prevent it. Backstage exposes no
   generic precondition mechanism ContextVerity could attach to arbitrary actions.
   ([ADR 0007](adr/0007-toctou-semantics.md))
2. **No global enforcement.** Backstage has no supported hook for intercepting other
   plugins' actions or MCP tool calls. Agents must call verify and honor the verdict.
   ([ADR 0006](adr/0006-mcp-integration-boundaries.md))
3. **Source truth is trusted.** ContextVerity detects that the catalog changed, not
   whether the catalog is right. A wrong but well-formed owner or classification is
   accepted.
4. **No judgment of natural language.** It is not a prompt-injection, hallucination,
   PII or malicious-content detector, and it does not read documentation content.
5. **Classification is declared, not inferred.** Only the
   `contextverity.github.io/classification` annotation (or the configured default)
   counts.
6. **TechDocs provenance is annotation-only.** The `backstage.io/techdocs-ref`
   annotation is tracked; documentation content changes are not.
7. **Service principals bypass Backstage permission policies** (upstream behavior),
   so permission revocation is only observable for user principals; revoke services
   through the context policy.
8. **Static-token agents through the MCP Actions backend lose their identity**
   (forwarded as `plugin:mcp-actions`). Such calls are refused by default.
9. **Clock.** TTL uses the server clock. With several replicas, clock skew between
   them shifts expiry by the skew.
10. **Unavailable sources force conservative outcomes.** A catalog outage turns every
    verification into `REFRESH` (or `DENY` with `denyOn`).
11. **Receipts are not portable.** Integrity tags are checked only by the issuing
    instance; there are no signed, independently verifiable receipts yet.
12. **One provider.** Only the Backstage catalog is implemented.
13. **Measured scope.** Results come from synthetic data on a single machine; the live
    lab runs a development-mode backend on SQLite, and the Kubernetes tier is a
    single-node kind cluster. No production deployment or adopter exists yet.
14. **No rate limiting** of verify calls beyond Backstage authentication.
