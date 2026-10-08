/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { metrics } from '@opentelemetry/api';
import { ContextVerity, INSTRUMENTATION_SCOPE } from '@contextverity/core';
import {
  CONTEXTVERITY_PLUGIN_ID,
  Sensitivity,
  contextverityPermissions,
  isSensitivity,
} from '@contextverity/plugin-contextverity-common';
import {
  BackstageCatalogProvider,
  BackstagePermissionAuthorizer,
  KnexReceiptStore,
} from '@contextverity/plugin-contextverity-node';
import { ConfigPolicySource } from './policies';
import { createRouter } from './router';
import { registerActions } from './actions';

/**
 * ContextVerity backend plugin.
 *
 * @public
 */
export const contextverityPlugin = createBackendPlugin({
  pluginId: CONTEXTVERITY_PLUGIN_ID,
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        auth: coreServices.auth,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        scheduler: coreServices.scheduler,
        catalog: catalogServiceRef,
        actionsRegistry: actionsRegistryServiceRef,
      },
      async init({
        config,
        logger,
        database,
        httpRouter,
        httpAuth,
        auth,
        permissions,
        permissionsRegistry,
        scheduler,
        catalog,
        actionsRegistry,
      }) {
        const issuer = config.getString('contextverity.issuer');
        const defaultClassification =
          config.getOptionalString('contextverity.defaultClassification') ??
          'INTERNAL';
        if (!isSensitivity(defaultClassification)) {
          throw new Error(
            `contextverity.defaultClassification must be PUBLIC, INTERNAL or RESTRICTED`,
          );
        }
        const store = await KnexReceiptStore.create(database);
        const policies = new ConfigPolicySource(config);
        await policies.list(); // fail fast on invalid policies at startup

        const provider = new BackstageCatalogProvider({
          defaultClassification: defaultClassification as Sensitivity,
          reader: {
            // Source state is read with this plugin's own credentials; the
            // consumer's access is evaluated separately by the authorizer.
            async getEntitiesByRefs(entityRefs) {
              const { items } = await catalog.getEntitiesByRefs(
                { entityRefs },
                { credentials: await auth.getOwnServiceCredentials() },
              );
              return items.map(i => i ?? undefined);
            },
          },
        });

        const service = new ContextVerity({
          issuer,
          provider,
          authorizer: new BackstagePermissionAuthorizer(permissions),
          policies,
          store,
          integritySecret: config.getOptionalString(
            'contextverity.integritySecret',
          ),
        });

        permissionsRegistry.addPermissions(contextverityPermissions);
        registerActions(actionsRegistry, service);
        httpRouter.use(
          await createRouter({ service, httpAuth, permissions, logger }),
        );

        metrics
          .getMeter(INSTRUMENTATION_SCOPE)
          .createObservableGauge('contextverity.receipts.active', {
            description: 'Receipts whose validUntil is in the future',
          })
          .addCallback(async result => {
            result.observe(await store.countActive(new Date()));
          });

        const days =
          config.getOptionalNumber('contextverity.retention.days') ?? 30;
        await scheduler.scheduleTask({
          id: 'contextverity-retention',
          frequency: { hours: 1 },
          timeout: { minutes: 5 },
          initialDelay: { minutes: 1 },
          fn: async () => {
            const removed = await store.deleteIssuedBefore(
              new Date(Date.now() - days * 86400_000),
            );
            if (removed)
              logger.info(
                `retention removed ${removed} receipts older than ${days} days`,
              );
          },
        });
        logger.info(`ContextVerity issuer '${issuer}' ready`);
      },
    });
  },
});
