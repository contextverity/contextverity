/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContextVerification,
  ReceiptDetail,
  ResolveRequest,
  ResolveResponse,
  VerifyIntent,
} from '@contextverity/plugin-contextverity-common';

export type Tier = 'core' | 'backstage' | 'kubernetes';

/** Synthetic actors. `alex` is a user; the agents are service principals. */
export type Actor = 'alex' | 'agent' | 'other';

export type ResolveOutcome =
  | { ok: true; response: ResolveResponse }
  | { ok: false; code: string; detail: string };

export interface EntityPatch {
  spec?: Record<string, unknown>;
  annotations?: Record<string, string | null>;
  labels?: Record<string, string | null>;
  metadata?: Record<string, unknown>;
}

/** Capability a scenario needs that a tier may lack. */
export type Capability =
  | 'clock'
  | 'outage'
  | 'restart'
  | 'issuer'
  | 'storage-tamper';

/**
 * Operations scenarios use to drive a world. Both tiers implement every
 * method; a tier lacking a capability throws `UnsupportedError`.
 */
export interface Harness {
  readonly tier: Tier;
  readonly capabilities: ReadonlySet<Capability>;
  reset(): Promise<void>;
  resolve(actor: Actor, request: ResolveRequest): Promise<ResolveOutcome>;
  verify(
    actor: Actor,
    receiptId: string,
    intent?: VerifyIntent,
  ): Promise<ContextVerification>;
  getReceipt(actor: Actor, receiptId: string): Promise<ReceiptDetail>;
  patchEntity(ref: string, patch: EntityPatch): Promise<void>;
  deleteEntity(ref: string): Promise<void>;
  recreateEntity(ref: string): Promise<void>;
  revoke(user: string, entityRef: string): Promise<void>;
  setPolicies(policies: unknown[]): Promise<void>;
  seedPolicies(): unknown[];
  /** Advance time. Tiers without a controllable clock really wait (bounded). */
  advance(ms: number): Promise<void>;
  setExactNow?(iso: string): void;
  setOutage(ref: string | '*', down: boolean): Promise<void>;
  restart(): Promise<void>;
  /** Verify through an instance configured with another issuer. */
  verifyAtOtherIssuer(
    actor: Actor,
    receiptId: string,
  ): Promise<ContextVerification>;
  tamperStoredReceipt(receiptId: string): Promise<void>;
  close(): Promise<void>;
}

export class UnsupportedError extends Error {
  constructor(readonly capability: Capability, reason: string) {
    super(reason);
    this.name = 'UnsupportedError';
  }
}
