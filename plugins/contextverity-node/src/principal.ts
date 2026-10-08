/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BackstageCredentials } from '@backstage/backend-plugin-api';
import type { Principal } from '@contextverity/core';

/**
 * Derives the stable principal reference bound into receipts:
 * - users: their user entity ref, e.g. `user:default/alex`;
 * - services: `service:<subject>`, e.g. `service:incident-agent`.
 *
 * @public
 */
export function principalFromCredentials(
  credentials: BackstageCredentials,
): Principal {
  const p = credentials.principal as {
    type: string;
    userEntityRef?: string;
    subject?: string;
  };
  if (p.type === 'user' && p.userEntityRef) {
    return { ref: p.userEntityRef.toLowerCase(), handle: credentials };
  }
  if (p.type === 'service' && p.subject) {
    return { ref: `service:${p.subject}`.toLowerCase(), handle: credentials };
  }
  throw new Error(`unsupported principal type '${p.type}'`);
}
