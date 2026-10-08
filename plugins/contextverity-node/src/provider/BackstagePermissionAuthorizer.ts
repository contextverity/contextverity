/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BackstageCredentials,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import { catalogEntityReadPermission } from '@backstage/plugin-catalog-common/alpha';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { PermissionDecisionRecord } from '@contextverity/plugin-contextverity-common';
import type { ContextAuthorizer, Principal } from '@contextverity/core';
import { entityRefFromSourceId } from './normalize';

/**
 * Authorizes context sources through the Backstage Permission Framework by
 * evaluating `catalog.entity.read` on the entity behind each source, with the
 * caller's own credentials. Decisions are never cached.
 *
 * Note: Backstage does not consult the permission policy for service
 * principals (they are allowed unless their external-access entry carries
 * `accessRestrictions`). Such decisions are recorded with basis
 * `service-principal`.
 *
 * @public
 */
export class BackstagePermissionAuthorizer implements ContextAuthorizer {
  constructor(private readonly permissions: PermissionsService) {}

  async authorize(
    principal: Principal,
    sourceIds: string[],
  ): Promise<PermissionDecisionRecord[]> {
    const credentials = principal.handle as BackstageCredentials | undefined;
    if (!credentials)
      throw new Error(
        'BackstagePermissionAuthorizer requires request credentials',
      );
    const basis =
      credentials.principal &&
      (credentials.principal as { type?: string }).type === 'service'
        ? 'service-principal'
        : 'permission-policy';

    const refs = sourceIds.map(id => entityRefFromSourceId(id));
    const unique = [
      ...new Set(refs.filter((r): r is string => Boolean(r))),
    ].sort();
    const decisions = unique.length
      ? await this.permissions.authorize(
          unique.map(resourceRef => ({
            permission: catalogEntityReadPermission,
            resourceRef,
          })),
          { credentials },
        )
      : [];
    const byRef = new Map(unique.map((ref, i) => [ref, decisions[i]?.result]));

    return sourceIds.map((sourceId, i): PermissionDecisionRecord => {
      const resourceRef = refs[i];
      const result = resourceRef ? byRef.get(resourceRef) : undefined;
      return {
        permission: catalogEntityReadPermission.name,
        resourceRef,
        sourceId,
        // Anything other than an explicit ALLOW (including an unknown source
        // type) is treated as DENY.
        result: result === AuthorizeResult.ALLOW ? 'ALLOW' : 'DENY',
        principal: principal.ref,
        basis,
      };
    });
  }
}
