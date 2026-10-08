/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Entity } from '@backstage/catalog-model';
import {
  MalformedEntityError,
  apiContractDigest,
  apiDefinitionRecord,
  classificationOf,
  entityRecord,
  entityRefFromSourceId,
} from './normalize';
import { BackstageCatalogProvider } from './BackstageCatalogProvider';

const ALL = [
  'identity',
  'ownership',
  'lifecycle',
  'dependencies',
  'apis',
  'api-definition',
  'documentation',
] as const;

function component(
  patch: Partial<Entity['metadata']> = {},
  relations = defaultRelations(),
): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: 'payments',
      namespace: 'default',
      uid: 'u1',
      etag: 'e1',
      ...patch,
    },
    spec: { type: 'service', lifecycle: 'production', owner: 'team-payments' },
    relations,
  };
}

function defaultRelations() {
  return [
    { type: 'ownedBy', targetRef: 'group:default/team-payments' },
    { type: 'dependsOn', targetRef: 'resource:default/payments-db' },
    { type: 'dependsOn', targetRef: 'component:default/notifications' },
    { type: 'partOf', targetRef: 'system:default/commerce' },
  ];
}

const record = (e: Entity) =>
  entityRecord(e, {
    categories: [...ALL],
    required: true,
    defaultClassification: 'INTERNAL',
  });

describe('entityRecord', () => {
  it('normalizes relations into sorted sets', () => {
    const r = record(component());
    expect(r.fields.dependsOn.value).toEqual([
      'component:default/notifications',
      'resource:default/payments-db',
    ]);
    expect(r.fields.owner.value).toBe('group:default/team-payments');
    expect(r.fields.system.value).toBe('system:default/commerce');
    expect(r.sourceId).toBe('catalog:component:default/payments');
    expect(r.identity).toBe('u1');
  });

  it('ignores relation order, etag, title, description, labels, tags, links and unrelated annotations', () => {
    const base = record(component());
    const noisy = record(
      component(
        {
          etag: 'e2',
          title: 'Payments',
          description: 'changed',
          labels: { tier: 'gold' },
          tags: ['x'],
          links: [{ url: 'https://example.invalid' }],
          annotations: { 'example.com/oncall': 'weekly' },
        },
        [...defaultRelations()].reverse(),
      ),
    );
    expect(noisy.digest).toBe(base.digest);
  });

  it('changes digest when a granted field or identity changes', () => {
    const base = record(component());
    const relations = defaultRelations().map(r =>
      r.type === 'ownedBy'
        ? { ...r, targetRef: 'group:default/team-commerce' }
        : r,
    );
    expect(record(component({}, relations)).digest).not.toBe(base.digest);
    expect(record(component({ uid: 'u2' })).digest).not.toBe(base.digest);
  });

  it('keeps only granted categories', () => {
    const r = entityRecord(component(), {
      categories: ['ownership'],
      required: true,
      defaultClassification: 'INTERNAL',
    });
    expect(Object.keys(r.fields)).toEqual(['owner']);
  });
});

describe('classificationOf', () => {
  it('uses the default when the annotation is absent and is case-insensitive', () => {
    expect(classificationOf(component(), 'PUBLIC')).toBe('PUBLIC');
    expect(
      classificationOf(
        component({
          annotations: {
            'contextverity.github.io/classification': ' restricted ',
          },
        }),
        'PUBLIC',
      ),
    ).toBe('RESTRICTED');
  });

  it('fails closed on unknown values', () => {
    expect(() =>
      classificationOf(
        component({
          annotations: { 'contextverity.github.io/classification': 'SECRET' },
        }),
        'PUBLIC',
      ),
    ).toThrow(MalformedEntityError);
  });
});

describe('API contracts', () => {
  const api = (spec: Record<string, unknown>): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'API',
    metadata: { name: 'payments-api', namespace: 'default', uid: 'a1' },
    spec: {
      type: 'openapi',
      lifecycle: 'production',
      owner: 'team-payments',
      ...spec,
    },
  });

  it('digests the definition without storing it and ignores CRLF vs LF', () => {
    const r = apiDefinitionRecord(
      api({ definition: 'openapi: 3.0.3\ninfo: {}\n' }),
      { defaultClassification: 'INTERNAL' },
    );
    expect(JSON.stringify(r)).not.toContain('openapi: 3.0.3');
    expect(r.kind).toBe('API_DEFINITION');
    expect(apiContractDigest({ definition: 'a\r\nb' })).toBe(
      apiContractDigest({ definition: 'a\nb' }),
    );
    expect(apiContractDigest({ definition: 'a\nb' })).not.toBe(
      apiContractDigest({ definition: 'a\nc' }),
    );
  });

  it('treats MCP server remotes as an unordered set', () => {
    const a = { type: 'streamable-http', url: 'http://a/mcp' };
    const b = { type: 'sse', url: 'http://b/sse' };
    expect(apiContractDigest({ remotes: [a, b] })).toBe(
      apiContractDigest({ remotes: [b, a] }),
    );
    expect(apiContractDigest({ remotes: [a] })).not.toBe(
      apiContractDigest({ remotes: [b] }),
    );
    expect(apiContractDigest({})).toBeNull();
  });
});

describe('BackstageCatalogProvider', () => {
  it('maps source ids back to entity refs', () => {
    expect(entityRefFromSourceId('apidef:api:default/x')).toBe('api:default/x');
    expect(entityRefFromSourceId('catalog:component:default/x')).toBe(
      'component:default/x',
    );
    expect(entityRefFromSourceId('other:x')).toBeUndefined();
  });

  it('reports NOT_FOUND, UNAVAILABLE and MALFORMED explicitly', async () => {
    const entities = new Map<string, Entity>([
      ['component:default/payments', component()],
    ]);
    let down = false;
    const provider = new BackstageCatalogProvider({
      defaultClassification: 'INTERNAL',
      reader: {
        getEntitiesByRefs: async refs => {
          if (down) throw new Error('catalog down');
          return refs.map(r => entities.get(r));
        },
      },
    });
    expect(
      await provider.resolve({
        subject: 'component:nope',
        categories: ['ownership'],
      }),
    ).toEqual({ status: 'NOT_FOUND' });
    const ok = await provider.resolve({
      subject: 'component:payments',
      categories: ['ownership'],
    });
    expect(ok.status).toBe('OK');
    const sources = ok.status === 'OK' ? ok.records : [];

    down = true;
    expect((await provider.observe(sources, ['ownership']))[0].status).toBe(
      'UNAVAILABLE',
    );
    down = false;
    entities.set(
      'component:default/payments',
      component({
        annotations: { 'contextverity.github.io/classification': 'nope' },
      }),
    );
    expect((await provider.observe(sources, ['ownership']))[0].status).toBe(
      'MALFORMED',
    );
    entities.delete('component:default/payments');
    expect((await provider.observe(sources, ['ownership']))[0].status).toBe(
      'NOT_FOUND',
    );
  });
});
