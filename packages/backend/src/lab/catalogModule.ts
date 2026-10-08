/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// DEMO-ONLY: feeds the synthetic lab catalog into the Backstage catalog
// through the supported EntityProvider extension point.

import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  EntityProvider,
  EntityProviderConnection,
  catalogProcessingExtensionPoint,
} from '@backstage/plugin-catalog-node';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
  Entity,
} from '@backstage/catalog-model';
import { labState } from './state';

const PROVIDER = 'contextverity-lab';
const LOCATION = `url:lab://${PROVIDER}`;

function withLocation(e: Entity): Entity {
  const copy = JSON.parse(JSON.stringify(e)) as Entity;
  copy.metadata.annotations = {
    ...copy.metadata.annotations,
    [ANNOTATION_LOCATION]: LOCATION,
    [ANNOTATION_ORIGIN_LOCATION]: LOCATION,
  };
  return copy;
}

class LabEntityProvider implements EntityProvider {
  getProviderName() {
    return PROVIDER;
  }
  async connect(connection: EntityProviderConnection) {
    labState.connect(async (added, removed) => {
      await connection.applyMutation({
        type: 'delta',
        added: added.map(e => ({
          entity: withLocation(e),
          locationKey: PROVIDER,
        })),
        removed: removed.map(e => ({
          entity: withLocation(e),
          locationKey: PROVIDER,
        })),
      });
    });
    await connection.applyMutation({
      type: 'full',
      entities: labState
        .all()
        .map(e => ({ entity: withLocation(e), locationKey: PROVIDER })),
    });
  }
}

export const labCatalogModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'contextverity-lab',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ catalog, config }) {
        labState.seed(config.getString('lab.catalogFile'));
        catalog.addEntityProvider(new LabEntityProvider());
      },
    });
  },
});
