/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import type { Config } from '@backstage/config';
import { parse as parseYaml } from 'yaml';
import { ContextPolicy, PolicySource, parsePolicy } from '@contextverity/core';

/**
 * Context policies could not be loaded or are invalid.
 *
 * @public
 */
export class PolicyLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PolicyLoadError';
  }
}

/**
 * Policies from `contextverity.policies` plus an optional YAML
 * `contextverity.policyFile`. The file is re-read on every call (it is small)
 * and re-parsed only when its content changed, so edits apply immediately.
 * An invalid file fails closed: listing throws, so resolve and verify fail
 * rather than proceeding without the policy.
 *
 * @public
 */
export class ConfigPolicySource implements PolicySource {
  private readonly inline: ContextPolicy[];
  private cache?: { content: string; policies: ContextPolicy[] };

  constructor(private readonly config: Config) {
    this.inline = (
      config.getOptional<unknown[]>('contextverity.policies') ?? []
    ).map(parsePolicy);
    assertUnique(this.inline);
  }

  async list(): Promise<ContextPolicy[]> {
    const file = this.config.getOptionalString('contextverity.policyFile');
    if (!file) return this.inline;
    try {
      return await this.loadFile(file);
    } catch (e) {
      throw new PolicyLoadError(
        `cannot load ${file}: ${(e as Error).message}`,
        { cause: e },
      );
    }
  }

  private async loadFile(file: string): Promise<ContextPolicy[]> {
    const content = await readFile(file, 'utf8');
    if (this.cache?.content !== content) {
      const doc = parseYaml(content) as { policies?: unknown[] } | null;
      const all = [...this.inline, ...(doc?.policies ?? []).map(parsePolicy)];
      assertUnique(all);
      this.cache = { content, policies: all };
    }
    return this.cache.policies;
  }
}

function assertUnique(policies: ContextPolicy[]) {
  const seen = new Set<string>();
  for (const p of policies) {
    if (seen.has(p.id))
      throw new Error(`duplicate context policy id '${p.id}'`);
    seen.add(p.id);
  }
}
