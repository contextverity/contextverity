/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContextReceipt,
  ContextVerification,
  ReceiptSummary,
} from '@contextverity/plugin-contextverity-common';

/**
 * A receipt as persisted: the receipt body plus its integrity tag.
 *
 * @public
 */
export interface StoredReceipt {
  receipt: ContextReceipt;
  integrity: string;
}

/**
 * Authoritative receipt storage. Receipts are written once and never updated;
 * verifications are appended.
 *
 * @public
 */
export interface ReceiptStore {
  insert(stored: StoredReceipt): Promise<void>;
  get(receiptId: string): Promise<StoredReceipt | undefined>;
  appendVerification(verification: ContextVerification): Promise<void>;
  listVerifications(
    receiptId: string,
    limit: number,
  ): Promise<ContextVerification[]>;
  list(options: {
    limit: number;
    consumer?: string;
    subject?: string;
  }): Promise<ReceiptSummary[]>;
  countActive(now: Date): Promise<number>;
  /** Deletes receipts (and their verifications) issued before `cutoff`. */
  deleteIssuedBefore(cutoff: Date): Promise<number>;
}

function newestFirst(
  a: { issuedAt: string; receiptId: string },
  b: { issuedAt: string; receiptId: string },
): number {
  if (a.issuedAt !== b.issuedAt) return a.issuedAt < b.issuedAt ? 1 : -1;
  return a.receiptId < b.receiptId ? 1 : -1;
}

/**
 * In-memory store for tests, benchmarks and embedding. Not durable.
 *
 * @public
 */
export class InMemoryReceiptStore implements ReceiptStore {
  private readonly receipts = new Map<string, string>();
  private readonly verifications = new Map<string, ContextVerification[]>();

  async insert(stored: StoredReceipt): Promise<void> {
    if (this.receipts.has(stored.receipt.receiptId)) {
      throw new Error(`receipt ${stored.receipt.receiptId} already exists`);
    }
    // Stored serialized, as a database would, so callers cannot mutate it.
    this.receipts.set(stored.receipt.receiptId, JSON.stringify(stored));
  }

  async get(receiptId: string): Promise<StoredReceipt | undefined> {
    const raw = this.receipts.get(receiptId);
    return raw ? (JSON.parse(raw) as StoredReceipt) : undefined;
  }

  /** Test hook: overwrite the raw stored row to simulate corruption. */
  corruptRaw(receiptId: string, mutate: (row: StoredReceipt) => void): void {
    const raw = this.receipts.get(receiptId);
    if (!raw) throw new Error('no such receipt');
    const row = JSON.parse(raw) as StoredReceipt;
    mutate(row);
    this.receipts.set(receiptId, JSON.stringify(row));
  }

  async appendVerification(v: ContextVerification): Promise<void> {
    const list = this.verifications.get(v.receiptId) ?? [];
    list.push(JSON.parse(JSON.stringify(v)));
    this.verifications.set(v.receiptId, list);
  }

  async listVerifications(
    receiptId: string,
    limit: number,
  ): Promise<ContextVerification[]> {
    return [...(this.verifications.get(receiptId) ?? [])]
      .reverse()
      .slice(0, limit);
  }

  async list(options: {
    limit: number;
    consumer?: string;
    subject?: string;
  }): Promise<ReceiptSummary[]> {
    const rows = [...this.receipts.values()]
      .map(raw => (JSON.parse(raw) as StoredReceipt).receipt)
      .filter(r => !options.consumer || r.consumer === options.consumer)
      .filter(r => !options.subject || r.subject === options.subject)
      .sort(newestFirst)
      .slice(0, options.limit);
    return rows.map(r => {
      const last = this.verifications.get(r.receiptId)?.at(-1);
      return {
        receiptId: r.receiptId,
        issuedAt: r.issuedAt,
        validUntil: r.validUntil,
        consumer: r.consumer,
        subject: r.subject,
        purpose: r.purpose,
        classification: r.classification,
        lastVerdict: last?.verdict,
        lastVerifiedAt: last?.verifiedAt,
      };
    });
  }

  async countActive(now: Date): Promise<number> {
    let n = 0;
    for (const raw of this.receipts.values()) {
      if (
        Date.parse((JSON.parse(raw) as StoredReceipt).receipt.validUntil) >
        now.getTime()
      )
        n++;
    }
    return n;
  }

  async deleteIssuedBefore(cutoff: Date): Promise<number> {
    let n = 0;
    for (const [id, raw] of this.receipts) {
      if (
        Date.parse((JSON.parse(raw) as StoredReceipt).receipt.issuedAt) <
        cutoff.getTime()
      ) {
        this.receipts.delete(id);
        this.verifications.delete(id);
        n++;
      }
    }
    return n;
  }
}
