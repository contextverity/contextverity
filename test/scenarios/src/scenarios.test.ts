/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolve } from 'node:path';
import { CoreHarness } from './harness/CoreHarness';
import { SCENARIOS } from './scenarios';
import { runScenario } from './runner';

const rootDir = resolve(__dirname, '../../..');

describe('context-drift scenarios (core tier)', () => {
  const h = new CoreHarness({ rootDir });
  afterAll(() => h.close());

  it('defines at least 30 scenarios with unique ids', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SCENARIOS.map(s => s.id)).size).toBe(SCENARIOS.length);
  });

  it.each(SCENARIOS.map(s => [s.id, s.title, s] as const))(
    '%s %s',
    async (_id, _title, s) => {
      const result = await runScenario(h, s);
      expect(result.failures ?? []).toEqual([]);
      expect(result.status).toBe('PASS');
    },
  );
});
