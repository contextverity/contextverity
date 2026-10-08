# ADR 0004: Canonicalization and digests

**Status:** accepted (2026-10-08)

## Decision

Digest normalized records, not raw objects. Canonical JSON follows RFC 8785 (JCS) for
the JSON subset ContextVerity emits: sorted keys (UTF-16 code units), ECMAScript number
and string serialization, no whitespace. Absent and `undefined` properties are
equivalent; non-finite numbers, `undefined` in arrays, and non-plain objects are
rejected. Semantically unordered lists (relations, tags, remotes) are normalized to
sorted, de-duplicated sets by the provider. Digests are SHA-256 (`sha256:<hex>`). API
definitions are digested after normalizing CRLF to LF.

## Consequences

- Semantically identical sources produce identical digests (S32, S33, S34); meaningful
  changes produce different digests.
- A digest detects change; it is not a signature.
- Tested with RFC 8785 vectors and a mutation check (unsorted sets fail S33).
