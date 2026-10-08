/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Container,
  Flex,
  Grid,
  Text,
} from '@backstage/ui';
import { useApi, useRouteRef } from '@backstage/frontend-plugin-api';
import { rootRouteRef } from '../routes';
import type {
  ContextVerification,
  PermissionDecisionRecord,
  ReceiptDetail,
  SourceRecord,
} from '@contextverity/plugin-contextverity-common';
import { contextverityApiRef } from '../api';
import {
  EffectLabel,
  VerdictLabel,
  cellStyle,
  formatTime,
  formatValue,
  monoNoWrap,
  monoStyle,
  shortDigest,
  tableStyle,
} from './format';

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <Flex direction="column" gap="1">
          <Text as="h2" variant="title-small">
            {title}
          </Text>
          {description && (
            <Text variant="body-small" color="secondary">
              {description}
            </Text>
          )}
        </Flex>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="1">
      <Text variant="body-x-small" color="secondary">
        {label}
      </Text>
      <div>{children}</div>
    </Flex>
  );
}

function Table({
  label,
  head,
  rows,
}: {
  label: string;
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle} aria-label={label}>
        <thead>
          <tr>
            {head.map(h => (
              <th key={h} style={cellStyle} scope="col">
                <Text variant="body-small" weight="bold">
                  {h}
                </Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} style={cellStyle}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BANNER: Record<string, string> = {
  VALID: 'var(--bui-fg-success, #1a7f37)',
  REFRESH: 'var(--bui-fg-warning, #9a6700)',
  DENY: 'var(--bui-fg-danger, #cf222e)',
};

function DriftView({ verification }: { verification: ContextVerification }) {
  const { verdict, drift, mode, verifiedAt } = verification;
  return (
    <Flex direction="column" gap="3">
      <Flex
        align="center"
        gap="3"
        style={{
          borderLeft: `4px solid ${BANNER[verdict]}`,
          paddingLeft: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <VerdictLabel verdict={verdict} size="title-small" />
        <Text variant="body-small" color="secondary">
          {mode === 'inspect'
            ? 'Operator drift check'
            : 'Verification by the consumer'}{' '}
          at {formatTime(verifiedAt)}
          {' · '}
          {verification.sourcesChecked} source(s) re-checked
        </Text>
      </Flex>
      {mode === 'inspect' && (
        <Alert
          status="info"
          title="Permissions not re-evaluated"
          description="An operator check re-reads sources, policy and TTL. The consumer's permissions are only re-evaluated when the consumer itself verifies."
        />
      )}
      {drift.length === 0 ? (
        <Text color="secondary">
          No drift. The context matched source, policy
          {mode === 'verify' ? ', permission' : ''} and time state at
          verification time. This is not a guarantee that nothing changes
          afterwards.
        </Text>
      ) : (
        <Table
          label="Drift"
          head={[
            'Effect',
            'Reason',
            'Source',
            'Field',
            'Before → after',
            'Detail',
          ]}
          rows={drift.map(d => [
            <EffectLabel effect={d.effect} />,
            <Text weight="bold" style={monoNoWrap}>
              {d.code}
            </Text>,
            <span style={monoStyle}>{d.sourceId ?? '—'}</span>,
            <span style={monoNoWrap}>{d.field ?? '—'}</span>,
            d.before === undefined && d.after === undefined ? (
              '—'
            ) : (
              <span style={monoStyle}>
                {formatValue(d.before)} → {formatValue(d.after)}
              </span>
            ),
            <Text variant="body-small">{d.detail}</Text>,
          ])}
        />
      )}
    </Flex>
  );
}

function SourceFields({ source }: { source: SourceRecord }) {
  const names = Object.keys(source.fields).sort();
  if (!names.length)
    return <Text color="secondary">no fields in the granted categories</Text>;
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        gap: '0.25rem 0.75rem',
      }}
    >
      {names.map(n => (
        <div key={n} style={{ display: 'contents' }}>
          <dt>
            <Text variant="body-small" color="secondary">
              {n}
            </Text>
          </dt>
          <dd style={{ margin: 0, ...monoStyle }}>
            {formatValue(source.fields[n].value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function permissionRows(perms: PermissionDecisionRecord[]) {
  return perms.map(p => [
    <span style={monoNoWrap}>{p.permission}</span>,
    <span style={monoNoWrap}>{p.resourceRef ?? '—'}</span>,
    <Text weight="bold" color={p.result === 'ALLOW' ? 'success' : 'danger'}>
      {p.result}
    </Text>,
    <Text variant="body-small">
      {p.basis === 'service-principal'
        ? 'service principal (policy not consulted)'
        : 'permission policy'}
    </Text>,
    <span style={monoNoWrap}>{p.principal}</span>,
  ]);
}

export function ReceiptDetailPage() {
  const { receiptId = '' } = useParams();
  const api = useApi(contextverityApiRef);
  const receiptsLink = useRouteRef(rootRouteRef);
  const [detail, setDetail] = useState<ReceiptDetail>();
  const [error, setError] = useState<Error>();
  const [inspection, setInspection] = useState<ContextVerification>();
  const [inspectError, setInspectError] = useState<Error>();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.getReceipt(receiptId).then(setDetail, setError);
  }, [api, receiptId]);

  const check = useCallback(async () => {
    setChecking(true);
    setInspectError(undefined);
    try {
      setInspection(await api.inspect(receiptId));
    } catch (e) {
      setInspectError(e as Error);
    } finally {
      setChecking(false);
    }
  }, [api, receiptId]);

  if (error) {
    return (
      <Container py="6">
        <Alert
          status="danger"
          title="Receipt not available"
          description={error.message}
        />
      </Container>
    );
  }
  if (!detail) {
    return (
      <Container py="6">
        <Text color="secondary">Loading…</Text>
      </Container>
    );
  }

  const { receipt, integrity, verifications } = detail;
  const current = inspection ?? verifications[0];
  const expired = Date.parse(receipt.validUntil) <= Date.now();

  return (
    <Container py="6">
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1">
          <RouterLink to={receiptsLink?.() ?? '/contextverity'}>
            ← All receipts
          </RouterLink>
          <Text as="h1" variant="title-medium" style={monoStyle}>
            {receipt.receiptId}
          </Text>
          <Text color="secondary">
            Context about <span style={monoStyle}>{receipt.subject}</span>{' '}
            issued to <span style={monoStyle}>{receipt.consumer}</span> for{' '}
            <strong>{receipt.purpose}</strong>.
          </Text>
        </Flex>

        {integrity === 'FAILED' && (
          <Alert
            status="danger"
            title="Integrity check failed"
            description="The stored receipt does not match its integrity tag. Verification returns DENY and no source state is compared."
          />
        )}

        <Section
          title="Current verdict"
          description="VALID · REFRESH (obtain fresh context) · DENY (context may not be used)"
        >
          <Flex direction="column" gap="3">
            {current ? (
              <DriftView verification={current} />
            ) : (
              <Text color="secondary">
                The consumer has not verified this receipt yet.
              </Text>
            )}
            <Flex gap="2" align="center">
              <Button variant="secondary" onPress={check} isPending={checking}>
                Check drift now
              </Button>
              {inspectError && (
                <Text color="danger">{inspectError.message}</Text>
              )}
            </Flex>
          </Flex>
        </Section>

        <Section title="Receipt">
          <Grid.Root columns={{ initial: '1', sm: '2', md: '4' }} gap="4">
            <Field label="Issued">{formatTime(receipt.issuedAt)}</Field>
            <Field label="Valid until">
              {formatTime(receipt.validUntil)}
              {expired && <Text color="warning"> (expired)</Text>}
            </Field>
            <Field label="Classification / ceiling">
              {receipt.classification} / {receipt.grant.sensitivityCeiling}
            </Field>
            <Field label="Integrity">
              <Text
                color={integrity === 'OK' ? 'success' : 'danger'}
                weight="bold"
              >
                {integrity}
              </Text>
            </Field>
            <Field label="Policy">
              <span style={monoStyle}>{receipt.grant.policyId}</span>
            </Field>
            <Field label="Policy digest">
              <span style={monoStyle}>
                {shortDigest(receipt.grant.policyDigest)}
              </span>
            </Field>
            <Field label="Granted categories">
              {receipt.grant.categories.join(', ')}
            </Field>
            <Field label="Issuer">
              <span style={monoStyle}>{receipt.issuer}</span>
            </Field>
            <Field label="Snapshot digest">
              <span style={monoStyle}>
                {shortDigest(receipt.snapshotDigest)}
              </span>
            </Field>
          </Grid.Root>
        </Section>

        <Section
          title="Source provenance"
          description="What each source looked like when the context was issued. Only fields in granted categories are recorded; API definitions are stored as digests."
        >
          <Flex direction="column" gap="4">
            {receipt.sources.map(s => (
              <Card key={s.sourceId}>
                <CardBody>
                  <Flex direction="column" gap="2">
                    <Flex gap="3" align="baseline" style={{ flexWrap: 'wrap' }}>
                      <Text weight="bold" style={monoStyle}>
                        {s.sourceId}
                      </Text>
                      <Text variant="body-small" color="secondary">
                        {s.kind} · {s.provider} · {s.classification} ·{' '}
                        {s.required ? 'required' : 'optional'}
                      </Text>
                    </Flex>
                    <Text variant="body-small" color="secondary">
                      identity{' '}
                      <span style={monoStyle}>{s.identity ?? '—'}</span> ·
                      digest{' '}
                      <span style={monoStyle}>{shortDigest(s.digest)}</span>
                    </Text>
                    <SourceFields source={s} />
                  </Flex>
                </CardBody>
              </Card>
            ))}
          </Flex>
        </Section>

        <Section
          title="Permissions at issue time"
          description="Re-evaluated on every verification; an issue-time ALLOW is never trusted later."
        >
          <Table
            label="Permission decisions"
            head={['Permission', 'Resource', 'Result', 'Basis', 'Principal']}
            rows={permissionRows(receipt.permissions)}
          />
        </Section>

        <Section
          title="Verification history"
          description="Most recent first. Only verifications by the bound consumer are recorded."
        >
          {verifications.length === 0 ? (
            <Text color="secondary">None yet.</Text>
          ) : (
            <Table
              label="Verification history"
              head={['Verified', 'By', 'Verdict', 'Reasons']}
              rows={verifications.map(v => [
                formatTime(v.verifiedAt),
                <span style={monoNoWrap}>{v.principal ?? '—'}</span>,
                <VerdictLabel verdict={v.verdict} />,
                <span style={monoStyle}>
                  {v.drift
                    .filter(d => d.effect !== 'NONE')
                    .map(d => d.code)
                    .join(', ') || '—'}
                </span>,
              ])}
            />
          )}
        </Section>
      </Flex>
    </Container>
  );
}
