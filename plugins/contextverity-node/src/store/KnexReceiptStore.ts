/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DatabaseService,
  resolvePackagePath,
} from '@backstage/backend-plugin-api';
import type { Knex } from 'knex';
import type {
  ContextVerification,
  ReceiptSummary,
  Verdict,
} from '@contextverity/plugin-contextverity-common';
import type { ReceiptStore, StoredReceipt } from '@contextverity/core';

const migrationsDir = resolvePackagePath(
  '@contextverity/plugin-contextverity-node',
  'migrations',
);

type ReceiptRow = {
  receipt_id: string;
  issuer: string;
  consumer: string;
  subject: string;
  purpose: string;
  classification: string;
  issued_at: string;
  valid_until: string;
  body: string;
  integrity: string;
};

/**
 * Receipt store on the plugin's Backstage-managed database (SQLite in
 * development, PostgreSQL in production). Receipts are inserted once and
 * never updated.
 *
 * @public
 */
export class KnexReceiptStore implements ReceiptStore {
  static async create(database: DatabaseService): Promise<KnexReceiptStore> {
    const client = await database.getClient();
    if (!database.migrations?.skip) {
      await client.migrate.latest({ directory: migrationsDir });
    }
    return new KnexReceiptStore(client);
  }

  constructor(private readonly db: Knex) {}

  async insert({ receipt, integrity }: StoredReceipt): Promise<void> {
    await this.db<ReceiptRow>('contextverity_receipts').insert({
      receipt_id: receipt.receiptId,
      issuer: receipt.issuer,
      consumer: receipt.consumer,
      subject: receipt.subject,
      purpose: receipt.purpose,
      classification: receipt.classification,
      issued_at: receipt.issuedAt,
      valid_until: receipt.validUntil,
      body: JSON.stringify(receipt),
      integrity,
    });
  }

  async get(receiptId: string): Promise<StoredReceipt | undefined> {
    const row = await this.db<ReceiptRow>('contextverity_receipts')
      .where({ receipt_id: receiptId })
      .first();
    if (!row) return undefined;
    let receipt: StoredReceipt['receipt'];
    try {
      receipt = JSON.parse(row.body);
    } catch {
      // Unparseable bodies are surfaced as integrity failures, never as valid.
      return {
        receipt: {
          receiptId,
          issuer: row.issuer,
          consumer: row.consumer,
        } as StoredReceipt['receipt'],
        integrity: 'corrupt',
      };
    }
    return { receipt, integrity: row.integrity };
  }

  async appendVerification(v: ContextVerification): Promise<void> {
    await this.db('contextverity_verifications').insert({
      receipt_id: v.receiptId,
      verified_at: v.verifiedAt,
      verdict: v.verdict,
      body: JSON.stringify(v),
    });
  }

  async listVerifications(
    receiptId: string,
    limit: number,
  ): Promise<ContextVerification[]> {
    const rows = await this.db('contextverity_verifications')
      .where({ receipt_id: receiptId })
      .orderBy('id', 'desc')
      .limit(limit)
      .select('body');
    return rows.map(r => JSON.parse(r.body));
  }

  async list(options: {
    limit: number;
    consumer?: string;
    subject?: string;
  }): Promise<ReceiptSummary[]> {
    let q = this.db<ReceiptRow>('contextverity_receipts')
      .orderBy([
        { column: 'issued_at', order: 'desc' },
        { column: 'receipt_id', order: 'desc' },
      ])
      .limit(options.limit);
    if (options.consumer) q = q.where({ consumer: options.consumer });
    if (options.subject) q = q.where({ subject: options.subject });
    const rows = await q.select(
      'receipt_id',
      'issued_at',
      'valid_until',
      'consumer',
      'subject',
      'purpose',
      'classification',
    );
    if (!rows.length) return [];

    const ids = rows.map(r => r.receipt_id);
    const latest = await this.db('contextverity_verifications as v')
      .whereIn('v.receipt_id', ids)
      .whereIn(
        'v.id',
        this.db('contextverity_verifications')
          .max('id')
          .whereIn('receipt_id', ids)
          .groupBy('receipt_id'),
      )
      .select('v.receipt_id', 'v.verdict', 'v.verified_at');
    const byId = new Map(latest.map(l => [l.receipt_id as string, l]));

    return rows.map(r => ({
      receiptId: r.receipt_id,
      issuedAt: r.issued_at,
      validUntil: r.valid_until,
      consumer: r.consumer,
      subject: r.subject,
      purpose: r.purpose,
      classification: r.classification as ReceiptSummary['classification'],
      lastVerdict: byId.get(r.receipt_id)?.verdict as Verdict | undefined,
      lastVerifiedAt: byId.get(r.receipt_id)?.verified_at,
    }));
  }

  async countActive(now: Date): Promise<number> {
    const [{ count }] = await this.db('contextverity_receipts')
      .where('valid_until', '>', now.toISOString())
      .count({ count: '*' });
    return Number(count);
  }

  async deleteIssuedBefore(cutoff: Date): Promise<number> {
    const before = cutoff.toISOString();
    let removed = 0;
    await this.db.transaction(async tx => {
      const old = tx('contextverity_receipts')
        .where('issued_at', '<', before)
        .select('receipt_id');
      await tx('contextverity_verifications')
        .whereIn('receipt_id', old)
        .delete();
      removed = Number(
        await tx('contextverity_receipts')
          .where('issued_at', '<', before)
          .delete(),
      );
    });
    return removed;
  }
}
