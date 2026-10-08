/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { FetchApi, createApiRef } from '@backstage/frontend-plugin-api';
import type {
  ContextVerification,
  ReceiptDetail,
  ReceiptSummary,
} from '@contextverity/plugin-contextverity-common';

/** @public */
export interface ContextVerityApi {
  listReceipts(options?: {
    limit?: number;
    subject?: string;
  }): Promise<ReceiptSummary[]>;
  getReceipt(receiptId: string): Promise<ReceiptDetail>;
  /** Operator drift check (requires contextverity.receipt.read). */
  inspect(receiptId: string): Promise<ContextVerification>;
}

/** @public */
export const contextverityApiRef = createApiRef<ContextVerityApi>({
  id: 'plugin.contextverity.client',
});

/**
 * Client for the ContextVerity backend. Uses the app's fetch API, which
 * resolves `plugin://` URLs and attaches the signed-in user's credentials.
 *
 * @public
 */
export class ContextVerityClient implements ContextVerityApi {
  constructor(private readonly fetchApi: FetchApi) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchApi.fetch(
      `plugin://contextverity/v1${path}`,
      init,
    );
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw new Error(
        body?.error?.message ?? `${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as T;
  }

  async listReceipts(options: { limit?: number; subject?: string } = {}) {
    const q = new URLSearchParams();
    if (options.limit) q.set('limit', String(options.limit));
    if (options.subject) q.set('subject', options.subject);
    return (await this.json<{ items: ReceiptSummary[] }>(`/receipts?${q}`))
      .items;
  }

  getReceipt(receiptId: string) {
    return this.json<ReceiptDetail>(
      `/receipts/${encodeURIComponent(receiptId)}`,
    );
  }

  inspect(receiptId: string) {
    return this.json<ContextVerification>(
      `/receipts/${encodeURIComponent(receiptId)}/inspect`,
      { method: 'POST' },
    );
  }
}
