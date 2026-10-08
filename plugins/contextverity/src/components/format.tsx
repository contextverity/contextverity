/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from '@backstage/ui';
import type {
  CanonicalValue,
  DriftEffect,
  Verdict,
} from '@contextverity/plugin-contextverity-common';

const VERDICT_COLOR = {
  VALID: 'success',
  REFRESH: 'warning',
  DENY: 'danger',
} as const;
const EFFECT_COLOR = {
  NONE: 'secondary',
  REFRESH: 'warning',
  DENY: 'danger',
} as const;

/** Verdict label; color is always paired with the word itself. */
export function VerdictLabel({
  verdict,
  size = 'body-medium',
}: {
  verdict?: Verdict;
  size?: 'body-medium' | 'title-small';
}) {
  if (!verdict) return <Text color="secondary">not verified</Text>;
  return (
    <Text
      variant={size}
      weight="bold"
      color={VERDICT_COLOR[verdict]}
      data-verdict={verdict}
    >
      {verdict}
    </Text>
  );
}

export function EffectLabel({ effect }: { effect: DriftEffect }) {
  return (
    <Text variant="body-small" weight="bold" color={EFFECT_COLOR[effect]}>
      {effect === 'NONE' ? 'info' : effect}
    </Text>
  );
}

export function formatValue(v: CanonicalValue | undefined): string {
  if (v === undefined || v === null) return '—';
  if (Array.isArray(v))
    return v.length ? v.map(x => formatValue(x)).join(', ') : '(none)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function shortDigest(d: string): string {
  const [alg, hex] = d.split(':');
  return hex ? `${alg}:${hex.slice(0, 12)}…` : d;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
};

export const cellStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--bui-border, rgba(127,127,127,0.25))',
  verticalAlign: 'top',
};

export const monoStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '0.8125rem',
  overflowWrap: 'anywhere',
};

/** Monospace that never wraps (table cells scroll horizontally instead). */
export const monoNoWrap: React.CSSProperties = {
  ...monoStyle,
  overflowWrap: 'normal',
  whiteSpace: 'nowrap',
};

/** `cv-b8aebb13-fbb1-…` → `cv-b8aebb13…` for dense lists; full id stays in the title. */
export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 11)}…` : id;
}
