/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Demo Backstage backend for the ContextVerity lab.

import { createBackend } from '@backstage/backend-defaults';
import { labCatalogModule, labPermissionPolicyModule, labPlugin } from './lab';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));

// Auth: guest sign-in for the local demo (development only).
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));

// Software Catalog with the AI model kinds (AiResource, mcp-server APIs).
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-ai-model'));

// Permission Framework.
backend.add(import('@backstage/plugin-permission-backend'));

// Official Backstage MCP Actions backend: exposes registered actions,
// including ContextVerity's, as MCP tools.
backend.add(import('@backstage/plugin-mcp-actions-backend'));

// ContextVerity.
backend.add(import('@contextverity/plugin-contextverity-backend'));

// DEMO-ONLY lab: synthetic catalog, mutable permission policy, control API.
backend.add(labCatalogModule);
backend.add(labPermissionPolicyModule);
backend.add(labPlugin);

backend.start();
