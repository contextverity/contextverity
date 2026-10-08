# ADR 0001: Receipt authority and integrity

**Status:** accepted (2026-10-08)

## Context

A receipt must be authoritative: verification cannot trust a JSON document the client
sends back. Two models were considered: (A) server-authoritative receipts with an
opaque ID, and (B) cryptographically signed, portable receipts.

## Decision

Model A. The server stores the receipt; clients get the ID and a read-only view;
verification always loads the stored copy. Each stored receipt carries an integrity
tag over its canonical JSON: HMAC-SHA256 with `contextverity.integritySecret`, or
SHA-256 without it. With a secret configured, unkeyed tags are rejected. Failure →
`RECEIPT_INTEGRITY_FAILED` (DENY), no source state read.

## Consequences

- Client edits are irrelevant; storage corruption and (with a secret) unauthorized
  database edits are detected (scenario S30).
- No home-grown cryptography: Node `crypto` primitives only.
- Receipts are not verifiable outside the issuing instance. Portable signed receipts
  (model B) require a mature standard and a key-management story; they are on the
  roadmap.
- Rotating the secret invalidates existing receipts (they verify as DENY).
