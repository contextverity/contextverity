/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import type {
  ContextVerification,
  ReceiptDetail,
  ResolveRequest,
  VerifyIntent,
} from '@contextverity/plugin-contextverity-common';
import {
  Actor,
  Capability,
  EntityPatch,
  Harness,
  ResolveOutcome,
  Tier,
  UnsupportedError,
} from './types';

export interface BackstageHarnessOptions {
  rootDir: string;
  baseUrl: string;
  agentToken: string;
  otherAgentToken: string;
  /** Lab data directory on this machine (for storage-tamper scenarios). */
  dataDir?: string;
}

/**
 * Drives the running lab backend over HTTP: ContextVerity's public API for
 * resolve/verify, and the demo-only lab API for changing the world. Every
 * change waits until the real catalog reflects it.
 */
export class BackstageHarness implements Harness {
  readonly tier: Tier = 'backstage';
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    'storage-tamper',
  ]);
  protected userToken?: string;

  constructor(protected readonly options: BackstageHarnessOptions) {}

  seedPolicies(): unknown[] {
    return (
      parseYaml(
        readFileSync(
          join(this.options.rootDir, 'examples/lab/policies.yaml'),
          'utf8',
        ),
      ) as { policies: unknown[] }
    ).policies;
  }

  private async token(actor: Actor): Promise<string> {
    if (actor === 'agent') return this.options.agentToken;
    if (actor === 'other') return this.options.otherAgentToken;
    if (!this.userToken) {
      const res = await fetch(`${this.options.baseUrl}/api/auth/guest/refresh`);
      if (!res.ok) throw new Error(`guest sign-in failed: ${res.status}`);
      this.userToken = (
        (await res.json()) as { backstageIdentity: { token: string } }
      ).backstageIdentity.token;
    }
    return this.userToken;
  }

  private async call(
    actor: Actor,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.token(actor)}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async lab(method: string, path: string, body?: unknown) {
    const res = await this.call('alex', method, `/api/lab${path}`, body);
    if (!res.ok)
      throw new Error(
        `lab ${method} ${path} failed: ${res.status} ${await res.text()}`,
      );
    return res.json();
  }

  async reset() {
    this.userToken = undefined;
    await this.setPolicies(this.seedPolicies());
    await this.lab('POST', '/reset');
  }

  async resolve(
    actor: Actor,
    request: ResolveRequest,
  ): Promise<ResolveOutcome> {
    const res = await this.call(
      actor,
      'POST',
      '/api/contextverity/v1/resolve',
      request,
    );
    const body = (await res.json()) as any;
    if (res.status === 201) return { ok: true, response: body };
    if (body?.error?.code)
      return { ok: false, code: body.error.code, detail: body.error.message };
    throw new Error(`resolve failed: ${res.status} ${JSON.stringify(body)}`);
  }

  async verify(
    actor: Actor,
    receiptId: string,
    intent: VerifyIntent = {},
  ): Promise<ContextVerification> {
    const res = await this.call(
      actor,
      'POST',
      `/api/contextverity/v1/receipts/${receiptId}/verify`,
      intent,
    );
    if (!res.ok)
      throw new Error(`verify failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<ContextVerification>;
  }

  async getReceipt(actor: Actor, receiptId: string): Promise<ReceiptDetail> {
    const res = await this.call(
      actor,
      'GET',
      `/api/contextverity/v1/receipts/${receiptId}`,
    );
    if (!res.ok) throw new Error(`get receipt failed: ${res.status}`);
    return res.json() as Promise<ReceiptDetail>;
  }

  private path(ref: string) {
    const m = /^([^:]+):([^/]+)\/(.+)$/.exec(ref);
    if (!m) throw new Error(`bad ref ${ref}`);
    return `/entities/${m[1]}/${m[2]}/${m[3]}`;
  }

  async patchEntity(ref: string, patch: EntityPatch) {
    await this.lab('PATCH', this.path(ref), patch);
  }
  async deleteEntity(ref: string) {
    await this.lab('DELETE', this.path(ref));
  }
  async recreateEntity(ref: string) {
    await this.lab('POST', `${this.path(ref)}/recreate`);
  }
  async revoke(user: string, entityRef: string) {
    await this.lab('POST', '/permissions/revoke', { user, entityRef });
  }
  async setPolicies(policies: unknown[]) {
    await this.lab('PUT', '/policies', { policies });
  }

  async advance(ms: number) {
    if (ms > 5000)
      throw new UnsupportedError('clock', 'live tier cannot wait this long');
    await new Promise(r => setTimeout(r, ms));
  }

  async setOutage(): Promise<void> {
    throw new UnsupportedError(
      'outage',
      'the live catalog cannot be taken down from a scenario',
    );
  }
  async restart(): Promise<void> {
    throw new UnsupportedError(
      'restart',
      'the scenario runner does not control the backend process',
    );
  }
  async verifyAtOtherIssuer(): Promise<ContextVerification> {
    throw new UnsupportedError(
      'issuer',
      'a second live instance with another issuer is not running',
    );
  }

  async tamperStoredReceipt(receiptId: string) {
    const db = new Database(
      join(this.options.dataDir ?? '', 'contextverity.sqlite'),
    );
    try {
      const row = db
        .prepare('select body from contextverity_receipts where receipt_id = ?')
        .get(receiptId) as { body: string };
      const body = JSON.parse(row.body);
      body.grant.sensitivityCeiling = 'RESTRICTED';
      db.prepare(
        'update contextverity_receipts set body = ? where receipt_id = ?',
      ).run(JSON.stringify(body), receiptId);
    } finally {
      db.close();
    }
  }

  async close() {}
}
