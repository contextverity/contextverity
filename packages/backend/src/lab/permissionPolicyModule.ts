/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// DEMO-ONLY permission policy. Allows everything except `catalog.entity.read`
// on entities the lab has revoked for a given user. Revocation is expressed
// as a real catalog conditional decision, so it is enforced by the catalog's
// own permission rules exactly as a production policy would be.

import { createBackendModule } from '@backstage/backend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import { catalogEntityReadPermission } from '@backstage/plugin-catalog-common/alpha';
import {
  AuthorizeResult,
  PermissionCondition,
  PermissionCriteria,
  PolicyDecision,
  isPermission,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import { labState } from './state';

class LabPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const principal = user?.credentials.principal as
      | { userEntityRef?: string }
      | undefined;
    if (
      !isPermission(request.permission, catalogEntityReadPermission) ||
      !principal?.userEntityRef
    ) {
      return { result: AuthorizeResult.ALLOW };
    }
    const revoked = labState.revokedFor(principal.userEntityRef);
    if (!revoked.length) return { result: AuthorizeResult.ALLOW };
    type Criteria = PermissionCriteria<PermissionCondition<'catalog-entity'>>;
    const [first, ...rest] = revoked.map((ref): Criteria => {
      const { kind, namespace, name } = parseEntityRef(ref);
      return {
        allOf: [
          catalogConditions.isEntityKind({ kinds: [kind] }),
          catalogConditions.hasMetadata({ key: 'namespace', value: namespace }),
          catalogConditions.hasMetadata({ key: 'name', value: name }),
        ],
      };
    });
    return createCatalogConditionalDecision(request.permission, {
      not: { anyOf: [first, ...rest] },
    });
  }
}

export const labPermissionPolicyModule = createBackendModule({
  pluginId: 'permission',
  moduleId: 'contextverity-lab-policy',
  register(env) {
    env.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new LabPermissionPolicy());
      },
    });
  },
});
