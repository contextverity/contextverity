/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Deterministic demo against the running lab. Every line printed below comes
// from a real HTTP response; nothing is echoed from a script.
// Usage: make demo-run   (after make demo-up)

import type {
  ContextVerification,
  ResolveRequest,
  ResolveResponse,
} from '@contextverity/plugin-contextverity-common';

const BASE = process.env.CV_BACKEND_URL ?? 'http://127.0.0.1:7007';
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) =>
  tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const bold = paint(1);
const dim = paint(2);
const COLORS: Record<string, (s: string) => string> = {
  VALID: paint(32),
  REFRESH: paint(33),
  DENY: paint(31),
};

let token = '';
async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `${method} ${path} -> ${res.status} ${JSON.stringify(json)}`,
    );
  return json as T;
}

let n = 0;
const step = (title: string) => console.log(`\n${bold(`[${++n}]`)} ${title}`);
const line = (k: string, v: string) => console.log(`    ${k.padEnd(13)} ${v}`);

const REQUEST: ResolveRequest = {
  subject: 'component:default/payments',
  purpose: 'incident-triage',
  categories: [
    'ownership',
    'lifecycle',
    'dependencies',
    'apis',
    'api-definition',
  ],
};

async function resolve(): Promise<ResolveResponse> {
  const r = await call<ResolveResponse>(
    'POST',
    '/api/contextverity/v1/resolve',
    REQUEST,
  );
  const subject = r.context.find(
    c => c.sourceId === `catalog:${REQUEST.subject}`,
  )!;
  line('Owner:', String(subject.fields.owner));
  line('Lifecycle:', String(subject.fields.lifecycle));
  line('APIs:', (subject.fields.providesApis as string[]).join(', '));
  line('Depends on:', (subject.fields.dependsOn as string[]).join(', '));
  line('Sensitivity:', r.receipt.classification);
  line(
    'Receipt:',
    `${r.receipt.receiptId} ${dim(`(valid until ${r.receipt.validUntil})`)}`,
  );
  line('Consumer:', r.receipt.consumer);
  return r;
}

async function verify(receiptId: string) {
  const t = performance.now();
  const v = await call<ContextVerification>(
    'POST',
    `/api/contextverity/v1/receipts/${receiptId}/verify`,
    {},
  );
  const ms = (performance.now() - t).toFixed(1);
  console.log(
    `    ${COLORS[v.verdict](bold(v.verdict))} ${dim(
      `(${ms} ms, ${v.sourcesChecked} sources re-checked)`,
    )}`,
  );
  for (const d of v.drift.filter(x => x.effect !== 'NONE')) {
    const change =
      d.before !== undefined || d.after !== undefined
        ? `: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`
        : '';
    console.log(
      `    reason: ${bold(d.code)} ${dim(
        `[${d.effect}] ${d.sourceId ?? ''}${
          d.field ? ` ${d.field}` : ''
        }${change}`,
      )}`,
    );
  }
  return v;
}

const lab = (method: string, path: string, body?: unknown) =>
  call<Record<string, unknown>>(method, `/api/lab${path}`, body);

async function main() {
  const health = await fetch(`${BASE}/.backstage/health/v1/readiness`).catch(
    () => undefined,
  );
  if (!health?.ok)
    throw new Error(`lab is not running at ${BASE}; run make demo-up`);
  const guest = await (await fetch(`${BASE}/api/auth/guest/refresh`)).json();
  token = guest.backstageIdentity.token;
  console.log(
    bold('ContextVerity demo') +
      dim(` — live Backstage lab at ${BASE}, synthetic data`),
  );
  await lab('POST', '/reset');

  step(`Resolve context for ${REQUEST.subject} (purpose: ${REQUEST.purpose})`);
  let r = await resolve();

  step('Verify without changes');
  await verify(r.receipt.receiptId);

  step('Change owner in the catalog');
  const owned = await lab('PATCH', '/entities/component/default/payments', {
    spec: { owner: 'team-commerce' },
  });
  line(
    'Owner:',
    `group:default/team-payments -> group:default/team-commerce ${dim(
      `(catalog settled in ${owned.settledMs} ms)`,
    )}`,
  );

  step('Verify the old receipt');
  await verify(r.receipt.receiptId);

  step('Resolve fresh context, then raise classification');
  r = await resolve();
  const raised = await lab('PATCH', '/entities/component/default/payments', {
    annotations: { 'contextverity.github.io/classification': 'RESTRICTED' },
  });
  line(
    'Sensitivity:',
    `INTERNAL -> RESTRICTED ${dim(
      `(catalog settled in ${raised.settledMs} ms)`,
    )}`,
  );

  step('Verify the receipt');
  await verify(r.receipt.receiptId);

  step(
    "Restore classification, resolve fresh context, then revoke the consumer's permission",
  );
  await lab('PATCH', '/entities/component/default/payments', {
    annotations: { 'contextverity.github.io/classification': 'INTERNAL' },
  });
  r = await resolve();
  await lab('POST', '/permissions/revoke', {
    user: r.receipt.consumer,
    entityRef: REQUEST.subject,
  });
  line(
    'Permission:',
    `catalog.entity.read on ${REQUEST.subject} revoked for ${
      r.receipt.consumer
    } ${dim('(lab permission policy)')}`,
  );

  step('Verify the receipt');
  await verify(r.receipt.receiptId);

  await lab('POST', '/reset');
  console.log(
    `\n${dim(
      'Lab world reset. Inspect receipts at http://127.0.0.1:3000/contextverity',
    )}`,
  );
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
