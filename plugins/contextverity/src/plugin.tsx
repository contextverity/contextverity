/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ApiBlueprint,
  PageBlueprint,
  createFrontendPlugin,
  fetchApiRef,
} from '@backstage/frontend-plugin-api';
import { ContextVerityClient, contextverityApiRef } from './api';
import { rootRouteRef } from './routes';

export { rootRouteRef };

const contextverityApi = ApiBlueprint.make({
  params: defineParams =>
    defineParams({
      api: contextverityApiRef,
      deps: { fetchApi: fetchApiRef },
      factory: ({ fetchApi }) => new ContextVerityClient(fetchApi),
    }),
});

const contextverityPage = PageBlueprint.make({
  params: {
    path: '/contextverity',
    title: 'Context receipts',
    routeRef: rootRouteRef,
    loader: () =>
      import('./components/ReceiptsPage').then(m => <m.ContextVerityPage />),
  },
});

/**
 * ContextVerity frontend plugin (new frontend system).
 *
 * @public
 */
export default createFrontendPlugin({
  pluginId: 'contextverity',
  title: 'ContextVerity',
  routes: { root: rootRouteRef },
  extensions: [contextverityApi, contextverityPage],
});
