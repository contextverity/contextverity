/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Reference MCP client (deterministic, no language model). It talks to the
// OFFICIAL Backstage MCP Actions endpoint and follows the explicit
// ContextVerity pattern: resolve context -> verify receipt -> act only on VALID.
//
// ContextVerity cannot intercept other actions; this client chooses to check.
// Usage: make demo-mcp   (after make demo-up)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.CV_BACKEND_URL ?? 'http://127.0.0.1:7007';
const MCP_URL = new URL(`${BASE}/api/mcp-actions/v1`);

async function connect(token: string) {
  const client = new Client({
    name: 'contextverity-reference-client',
    version: '0.1.0',
  });
  await client.connect(
    new StreamableHTTPClientTransport(MCP_URL, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function tool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError)
    throw new Error(`${name} failed: ${JSON.stringify(res.content)}`);
  return (res.structuredContent ??
    JSON.parse((res.content as Array<{ text: string }>)[0].text)) as T;
}

type Resolved = {
  outcome: 'ISSUED' | 'DENIED';
  receiptId?: string;
  denialCode?: string;
  detail?: string;
};
type Verified = {
  verdict: 'VALID' | 'REFRESH' | 'DENY';
  drift: Array<{ code: string; effect: string }>;
};

/** The guarded step: an agent acts only if its context still verifies. */
async function actIfValid(client: Client, receiptId: string, label: string) {
  const v = await tool<Verified>(client, 'contextverity.verify-receipt', {
    receiptId,
    purpose: 'incident-triage',
  });
  const reasons = v.drift
    .filter(d => d.effect !== 'NONE')
    .map(d => d.code)
    .join(', ');
  console.log(
    `  verify-receipt -> ${v.verdict}${reasons ? ` (${reasons})` : ''}`,
  );
  if (v.verdict !== 'VALID') {
    console.log(
      `  ${label}: NOT performed; ${
        v.verdict === 'REFRESH'
          ? 're-resolve context first'
          : 'context may not be used'
      }`,
    );
    return;
  }
  const entity = await tool<{ spec?: { owner?: string } }>(
    client,
    'catalog.get-catalog-entity',
    {
      kind: 'component',
      namespace: 'default',
      name: 'payments',
    },
  );
  console.log(
    `  ${label}: performed via catalog.get-catalog-entity (owner ${
      entity.spec?.owner ?? 'n/a'
    })`,
  );
}

async function main() {
  const guest = await (await fetch(`${BASE}/api/auth/guest/refresh`)).json();
  const userToken: string = guest.backstageIdentity.token;
  const lab = (method: string, path: string, body?: unknown) =>
    fetch(`${BASE}/api/lab${path}`, {
      method,
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => {
      if (!r.ok) throw new Error(`lab ${path}: ${r.status}`);
    });
  await lab('POST', '/reset');

  console.log(
    `MCP endpoint: ${MCP_URL} (official @backstage/plugin-mcp-actions-backend)\n`,
  );
  console.log(
    '1. User principal (identity is forwarded to actions as the user)',
  );
  const client = await connect(userToken);
  const tools = (await client.listTools()).tools
    .map(t => t.name)
    .filter(n => n.startsWith('contextverity.'));
  console.log(`  tools: ${tools.join(', ')}`);
  const r = await tool<Resolved>(client, 'contextverity.resolve-context', {
    subject: 'component:default/payments',
    purpose: 'incident-triage',
    categories: ['ownership', 'dependencies'],
  });
  console.log(
    `  resolve-context -> ${r.outcome} ${r.receiptId ?? r.denialCode}`,
  );
  await actIfValid(client, r.receiptId!, 'action');
  await lab('PATCH', '/entities/component/default/payments', {
    spec: { owner: 'team-commerce' },
  });
  console.log('  (catalog: payments owner changed)');
  await actIfValid(client, r.receiptId!, 'action');
  await client.close();

  const agentToken = process.env.CV_AGENT_TOKEN;
  if (agentToken) {
    console.log(
      '\n2. Service principal via static token (service:incident-agent)',
    );
    const agent = await connect(agentToken);
    const a = await tool<Resolved>(agent, 'contextverity.resolve-context', {
      subject: 'component:default/payments',
      purpose: 'incident-triage',
      categories: ['ownership'],
    });
    console.log(
      `  resolve-context -> ${a.outcome} ${a.denialCode ?? a.receiptId}`,
    );
    console.log(
      "  Backstage forwards service callers to actions as plugin:mcp-actions, so the agent's own",
    );
    console.log(
      '  identity is not visible to ContextVerity on this path. No policy grants context to that',
    );
    console.log(
      '  shared identity, so the request is refused rather than bound to the wrong consumer.',
    );
    await agent.close();
  }
  await lab('POST', '/reset');
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
