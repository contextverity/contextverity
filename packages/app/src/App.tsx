/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import contextverityPlugin from '@contextverity/plugin-contextverity';
import { navModule } from './modules/nav';

export default createApp({
  features: [catalogPlugin, contextverityPlugin, navModule],
});
