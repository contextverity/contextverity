/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import type { ReceiptDetail } from '@contextverity/plugin-contextverity-common';
import { ContextVerityApi, contextverityApiRef } from '../api';
import { ContextVerityPage } from './ReceiptsPage';
import { rootRouteRef } from '../routes';

const detail: ReceiptDetail = {
  integrity: 'OK',
  receipt: {
    receiptId: 'cv-1',
    issuer: 'lab-local',
    schemaVersion: 1,
    issuedAt: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-01-01T00:15:00.000Z',
    consumer: 'user:default/alex',
    subject: 'component:default/payments',
    purpose: 'incident-triage',
    classification: 'INTERNAL',
    snapshotDigest: 'sha256:aaaaaaaaaaaaaaaaaaaa',
    grant: {
      policyId: 'incident-triage',
      policyDigest: 'sha256:bbbbbbbbbbbbbbbbbbbb',
      consumer: 'user:default/alex',
      purpose: 'incident-triage',
      subject: 'component:default/payments',
      categories: ['ownership'],
      sourceKinds: ['CATALOG_ENTITY'],
      sensitivityCeiling: 'INTERNAL',
      ttlSeconds: 900,
    },
    sources: [
      {
        sourceId: 'catalog:component:default/payments',
        kind: 'CATALOG_ENTITY',
        provider: 'backstage-catalog',
        identity: 'uid-1',
        required: true,
        classification: 'INTERNAL',
        fields: {
          owner: {
            category: 'ownership',
            value: 'group:default/team-payments',
          },
        },
        digest: 'sha256:cccccccccccccccccccc',
      },
    ],
    permissions: [
      {
        permission: 'catalog.entity.read',
        resourceRef: 'component:default/payments',
        sourceId: 'catalog:component:default/payments',
        result: 'ALLOW',
        principal: 'user:default/alex',
        basis: 'permission-policy',
      },
    ],
  },
  verifications: [
    {
      receiptId: 'cv-1',
      mode: 'verify',
      principal: 'user:default/alex',
      verifiedAt: '2026-01-01T00:05:00.000Z',
      verdict: 'REFRESH',
      sourcesChecked: 1,
      permissions: [],
      drift: [
        {
          code: 'OWNER_CHANGED',
          effect: 'REFRESH',
          sourceId: 'catalog:component:default/payments',
          field: 'owner',
          before: 'group:default/team-payments',
          after: 'group:default/team-commerce',
          detail: 'owner changed',
        },
      ],
    },
  ],
};

const api: ContextVerityApi = {
  listReceipts: async () => [],
  getReceipt: async () => detail,
  inspect: async () => ({
    ...detail.verifications[0],
    mode: 'inspect',
    verdict: 'VALID',
    drift: [],
  }),
};

describe('ContextVerityPage', () => {
  it('explains why a receipt needs refresh', async () => {
    renderInTestApp(<ContextVerityPage />, {
      apis: [[contextverityApiRef, api]],
      initialRouteEntries: ['/receipts/cv-1'],
      mountedRoutes: { '/': rootRouteRef },
    });
    expect((await screen.findAllByText('OWNER_CHANGED')).length).toBe(2); // drift table + history
    expect(screen.getAllByText('REFRESH').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'group:default/team-payments → group:default/team-commerce',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('catalog.entity.read')).toBeInTheDocument();
  });

  it('shows an empty state for the receipts list', async () => {
    renderInTestApp(<ContextVerityPage />, {
      apis: [[contextverityApiRef, api]],
    });
    expect(await screen.findByText('No receipts yet')).toBeInTheDocument();
  });
});
