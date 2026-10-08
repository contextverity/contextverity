/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Generates DEPENDENCIES.md from the workspace manifests and the installed
// packages (exact resolved version and declared license).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifests = [
  'package.json',
  ...globSync('plugins/*/package.json', { cwd: root }),
  ...globSync('packages/*/package.json', { cwd: root }),
  ...globSync('test/*/package.json', { cwd: root }),
];

const PURPOSE = {
  '@backstage/backend-plugin-api':
    'Backend plugin system: plugin definition, core services, actions registry (alpha)',
  '@backstage/catalog-model': 'Catalog entity types',
  '@backstage/config': 'Typed access to app-config',
  '@backstage/errors':
    'Standard HTTP error types mapped by the Backstage router',
  '@backstage/plugin-catalog-node':
    'Catalog service for reading entities from a backend plugin; entity provider extension point (lab)',
  '@backstage/plugin-catalog-common':
    '`catalog.entity.read` permission definition',
  '@backstage/plugin-permission-common':
    'Permission types; `createPermission` for `contextverity.receipt.read`',
  '@backstage/plugin-permission-node':
    'Permission policy types (lab policy, conditional decisions)',
  '@backstage/frontend-plugin-api':
    'New frontend system: plugin, page and API blueprints, fetch API',
  '@backstage/core-plugin-api': 'Frontend plugin API compatibility for the app',
  '@backstage/plugin-catalog-react': 'Catalog frontend helpers',
  '@backstage/ui': 'Backstage UI components used by the receipts pages',
  '@backstage/backend-test-utils':
    'startTestBackend, mock services and credentials for integration tests',
  '@backstage/frontend-test-utils': 'renderInTestApp for frontend tests',
  '@backstage/cli':
    'Build, lint, test (Jest) and dev server for Backstage packages; TypeScript require hook for scripts',
  '@backstage/cli-defaults': 'Default Backstage CLI modules',
  '@backstage/backend-defaults': 'Lab backend: default service implementations',
  '@backstage/frontend-defaults': 'Lab app: createApp',
  '@backstage/core-components': 'Lab app: sidebar components',
  '@backstage/plugin-app-backend': 'Lab: serves the app',
  '@backstage/plugin-app-react': 'Lab app: navigation blueprint',
  '@backstage/plugin-app-module-user-settings': 'Lab app: user settings module',
  '@backstage/plugin-user-settings': 'Lab app: settings page',
  '@backstage/plugin-auth-backend': 'Lab: auth backend',
  '@backstage/plugin-auth-backend-module-guest-provider':
    'Lab: development-only guest sign-in (user:default/alex)',
  '@backstage/plugin-auth-node': 'Lab: auth types',
  '@backstage/plugin-catalog': 'Lab app: catalog pages',
  '@backstage/plugin-catalog-backend':
    'Lab: Software Catalog backend; catalog permission conditions for the lab policy',
  '@backstage/plugin-catalog-backend-module-ai-model':
    'Lab: AiResource kind and mcp-server API type',
  '@backstage/plugin-mcp-actions-backend':
    'Lab: official MCP Actions backend exposing actions as MCP tools',
  '@backstage/plugin-permission-backend': 'Lab: permission backend',
  '@backstage/plugin-api-docs': 'Lab app: API pages',
  '@backstage/plugin-org': 'Lab app: group and user pages',
  '@opentelemetry/api':
    'Vendor-neutral tracing and metrics API (core instrumentation)',
  '@opentelemetry/sdk-trace-base': 'Span processors (tests, lab)',
  '@opentelemetry/sdk-metrics': 'Meter provider (tests, lab)',
  '@opentelemetry/context-async-hooks': 'Context manager for telemetry tests',
  '@opentelemetry/sdk-node': 'Lab: Node SDK for traces',
  '@opentelemetry/resources': 'Lab: telemetry resource attributes',
  '@opentelemetry/exporter-prometheus':
    'Lab: Prometheus metrics endpoint on 127.0.0.1:9464',
  '@opentelemetry/exporter-trace-otlp-http': 'Lab: optional OTLP trace export',
  '@opentelemetry/instrumentation-http':
    'Lab: W3C trace-context extraction on incoming HTTP',
  '@opentelemetry/instrumentation-undici':
    'Lab: trace-context injection on outgoing fetch (links spans to MCP tools/call)',
  '@modelcontextprotocol/sdk': 'Reference MCP client (`make demo-mcp`)',
  express: 'HTTP router (backend plugin, lab API)',
  'express-promise-router': 'Async route handlers',
  knex: 'SQL query builder used by Backstage database service; receipt store and migrations',
  yaml: 'Parse policy files and lab catalog',
  zod: 'Action input/output schemas (Backstage Actions Registry)',
  'better-sqlite3':
    'SQLite driver (development database, tests, scenario harness)',
  pg: 'Lab: PostgreSQL driver available to the Backstage database service',
  'node-gyp': 'Builds native modules (better-sqlite3)',
  react: 'UI library (frontend plugin, lab app)',
  'react-dom': 'React DOM renderer',
  'react-router': 'Routing (lab app)',
  'react-router-dom': 'Routing between receipts list and detail',
  '@material-ui/core': 'Lab app template styles (legacy Backstage dependency)',
  '@material-ui/icons': 'Lab app template icons',
  jest: 'Test runner (via Backstage CLI)',
  '@jest/environment-jsdom-abstract': 'Jest DOM environment (Backstage CLI)',
  jsdom: 'DOM implementation for frontend tests',
  '@testing-library/react': 'React component tests',
  '@testing-library/dom': 'DOM queries for tests',
  '@testing-library/jest-dom': 'DOM matchers',
  '@testing-library/user-event': 'User interaction simulation',
  supertest: 'HTTP assertions in backend integration tests',
  typescript: 'Type checking',
  prettier: 'Formatting',
  'cross-env': 'Cross-platform env vars in app scripts',
  '@types/better-sqlite3': 'Types',
  '@types/express': 'Types',
  '@types/jest': 'Types',
  '@types/react': 'Types',
  '@types/react-dom': 'Types',
  '@types/supertest': 'Types',
};

function governance(name) {
  if (name.startsWith('@backstage/')) return 'Backstage — CNCF Incubating';
  if (name.startsWith('@opentelemetry/'))
    return 'OpenTelemetry — CNCF Graduated';
  if (name === '@modelcontextprotocol/sdk')
    return 'Model Context Protocol — Linux Foundation (Agentic AI Foundation)';
  if (['express', 'jest', 'node-gyp', 'jsdom'].includes(name))
    return 'OpenJS Foundation';
  return '';
}

const deps = new Map();
for (const m of manifests) {
  const pkg = JSON.parse(readFileSync(join(root, m), 'utf8'));
  const where = m.startsWith('plugins/')
    ? 'plugin'
    : m.startsWith('packages/')
    ? 'lab'
    : m.startsWith('test/')
    ? 'test'
    : 'root';
  for (const [type, cls] of [
    ['dependencies', null],
    ['devDependencies', 'build/test'],
    ['peerDependencies', 'peer'],
  ]) {
    for (const name of Object.keys(pkg[type] ?? {})) {
      if (
        name.startsWith('@contextverity/') ||
        name === 'app' ||
        name === 'backend'
      )
        continue;
      const classification =
        cls ??
        {
          plugin: 'runtime',
          lab: 'demo (lab)',
          test: 'test',
          root: 'build/test',
        }[where];
      const e = deps.get(name) ?? { classes: new Set(), users: new Set() };
      e.classes.add(classification);
      e.users.add(pkg.name);
      deps.set(name, e);
    }
  }
}

const rows = [...deps.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([name, e]) => {
    const p = join(root, 'node_modules', name, 'package.json');
    const meta = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
    const license =
      typeof meta.license === 'string'
        ? meta.license
        : meta.license?.type ??
          meta.licenses?.map(l => l.type ?? l).join(' OR ') ??
          'see package';
    return `| \`${name}\` | ${meta.version ?? '?'} | ${license} | ${[
      ...e.classes,
    ]
      .sort()
      .join(', ')} | ${PURPOSE[name] ?? '—'} | ${governance(name)} |`;
  });

const runtime = [...deps.entries()]
  .filter(([, e]) => e.classes.has('runtime'))
  .map(([n]) => `\`${n}\``);
writeFileSync(
  join(root, 'DEPENDENCIES.md'),
  [
    '<!-- Generated by scripts/dependencies.mjs. Do not edit by hand. -->',
    '',
    '# Dependencies',
    '',
    'Direct dependencies of every workspace package, with the exact version resolved in `yarn.lock` and the license declared by the installed package.',
    '',
    '- **runtime** — needed by the published ContextVerity plugins.',
    '- **demo (lab)** — only the local Backstage lab in `packages/` uses it.',
    '- **build/test** — development, tests and tooling only.',
    '',
    `Runtime dependencies of the plugins: ${runtime.join(
      ', ',
    )}. None requires a proprietary service; no language-model SDK is a dependency.`,
    '',
    '| Package | Version | License | Classification | Why it is needed | Governance |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'Upstream maturity levels were checked on the CNCF project pages; see [docs/upstream-compatibility.md](docs/upstream-compatibility.md).',
    '',
  ].join('\n'),
);
console.log(`DEPENDENCIES.md: ${rows.length} packages`);
