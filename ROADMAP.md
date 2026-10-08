# Roadmap

v0.1 is intentionally narrow: one source provider (the Backstage Software Catalog),
the Backstage Permission Framework, server-authoritative receipts, and explicit
verification via HTTP and Backstage actions. Everything below is **planned, not
implemented**. Priorities follow user feedback.

## Next

- **TechDocs content provenance.** Record the TechDocs `etag` / `build_timestamp`
  exposed by the TechDocs backend metadata endpoint, so documentation drift is
  detected from content, not just the `backstage.io/techdocs-ref` annotation.
- **Production-mode benchmarks** on PostgreSQL and a built (non-development)
  backend, published separately from the development-lab numbers.
- **Kubernetes deployment example** (Helm chart, non-root, probes, NetworkPolicy)
  once validated end to end on kind.
- **Entity-scoped receipt views** in the Backstage entity page.

## Later

- **Additional source providers**, for example Git or Kubernetes, behind the existing
  provider interface.
- **Additional authorization providers**, for example OpenFGA, where they solve a
  real provider problem — without replacing the Backstage-native path.
- **Portable signed receipts** using a mature, standard signing format with a
  documented key-management and trust model, for verification outside the issuing
  instance.
- **Per-agent identity through MCP.** Today Backstage forwards static-token agents to
  actions as `plugin:mcp-actions`; follow upstream work on delegated identity.
- **Precondition-based verify-and-act** for actions that support optimistic
  concurrency, to narrow the TOCTOU window documented in
  [ADR 0007](docs/adr/0007-toctou-semantics.md).

## Not planned

- An MCP server, AI gateway or prompt-injection detector.
- Any language-model-based decision in the verifier.
