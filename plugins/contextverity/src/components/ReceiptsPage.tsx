/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink, Route, Routes } from 'react-router-dom';
import { Alert, Container, Flex, Text } from '@backstage/ui';
import { useApi } from '@backstage/frontend-plugin-api';
import type { ReceiptSummary } from '@contextverity/plugin-contextverity-common';
import { contextverityApiRef } from '../api';
import { ReceiptDetailPage } from './ReceiptDetailPage';
import {
  VerdictLabel,
  cellStyle,
  formatTime,
  monoNoWrap,
  shortId,
  tableStyle,
} from './format';

/** Root of the plugin page: receipts list and receipt detail. */
export function ContextVerityPage() {
  return (
    <Routes>
      <Route path="/" element={<ReceiptsList />} />
      <Route path="/receipts/:receiptId" element={<ReceiptDetailPage />} />
    </Routes>
  );
}

export function ReceiptsList() {
  const api = useApi(contextverityApiRef);
  const [items, setItems] = useState<ReceiptSummary[]>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    api.listReceipts({ limit: 100 }).then(setItems, setError);
  }, [api]);

  return (
    <Container py="6">
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1">
          <Text color="secondary">
            Context issued to agents and users, with the source state it was
            based on. Open a receipt to see its provenance and what has drifted.
          </Text>
        </Flex>
        {error && (
          <Alert
            status="danger"
            title="Could not load receipts"
            description={error.message}
          />
        )}
        {!items && !error && <Text color="secondary">Loading…</Text>}
        {items && items.length === 0 && (
          <Alert
            status="info"
            title="No receipts yet"
            description="Receipts appear here after a consumer calls resolve."
          />
        )}
        {items && items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle} aria-label="Context receipts">
              <thead>
                <tr>
                  {[
                    'Receipt',
                    'Subject',
                    'Consumer',
                    'Purpose',
                    'Class.',
                    'Issued',
                    'Valid until',
                    'Last verdict',
                  ].map(h => (
                    <th key={h} style={cellStyle} scope="col">
                      <Text variant="body-small" weight="bold">
                        {h}
                      </Text>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(r => {
                  const expired = Date.parse(r.validUntil) <= Date.now();
                  return (
                    <tr key={r.receiptId}>
                      <td style={cellStyle}>
                        <RouterLink
                          to={`receipts/${encodeURIComponent(r.receiptId)}`}
                          style={monoNoWrap}
                          title={r.receiptId}
                        >
                          {shortId(r.receiptId)}
                        </RouterLink>
                      </td>
                      <td style={{ ...cellStyle, ...monoNoWrap }}>
                        {r.subject}
                      </td>
                      <td style={{ ...cellStyle, ...monoNoWrap }}>
                        {r.consumer}
                      </td>
                      <td style={cellStyle}>{r.purpose}</td>
                      <td style={cellStyle}>{r.classification}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        {formatTime(r.issuedAt)}
                      </td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        {formatTime(r.validUntil)}
                        {expired && (
                          <Text variant="body-small" color="warning">
                            {' '}
                            (expired)
                          </Text>
                        )}
                      </td>
                      <td style={cellStyle}>
                        <VerdictLabel verdict={r.lastVerdict} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Flex>
    </Container>
  );
}
