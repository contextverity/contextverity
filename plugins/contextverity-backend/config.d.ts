/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Config {
  contextverity?: {
    /**
     * Identifier of this ContextVerity instance, bound into every receipt.
     * Receipts presented to an instance with a different issuer are denied.
     */
    issuer: string;
    /**
     * Classification applied to entities without the
     * `contextverity.github.io/classification` annotation.
     * @default INTERNAL
     */
    defaultClassification?: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
    /**
     * Optional secret for HMAC-SHA256 receipt integrity tags. Without it,
     * stored receipts carry a plain SHA-256 tag (detects corruption, not
     * deliberate edits by someone with database write access).
     * @visibility secret
     */
    integritySecret?: string;
    /**
     * Service principal refs (e.g. `service:ops-bot`) allowed to read receipts
     * issued to others. Backstage does not apply permission policies to
     * services, so `contextverity.receipt.read` alone cannot grant this.
     */
    receiptReaders?: string[];
    retention?: {
      /** Delete receipts issued more than this many days ago. @default 30 */
      days?: number;
    };
    /** Inline context policies. */
    policies?: Array<{
      id: string;
      description?: string;
      consumers: string[];
      purposes: string[];
      subjects?: { kinds?: string[]; namespaces?: string[]; refs?: string[] };
      allowedSourceKinds: string[];
      allowedCategories: string[];
      sensitivityCeiling: string;
      maxTtlSeconds: number;
      requireFresh?: string[];
      denyOn?: string[];
    }>;
    /**
     * Path to a YAML file with a top-level `policies` list. Re-read when its
     * modification time changes, so policies can change without a restart.
     */
    policyFile?: string;
  };
}
