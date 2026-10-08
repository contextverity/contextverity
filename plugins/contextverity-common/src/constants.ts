/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Catalog annotation declaring the classification of an entity's context.
 * Values: `PUBLIC`, `INTERNAL`, `RESTRICTED` (case-insensitive).
 *
 * The key uses the `contextverity.github.io` prefix because that is the DNS
 * name the project controls.
 *
 * @public
 */
export const CLASSIFICATION_ANNOTATION =
  'contextverity.github.io/classification';

/**
 * Backstage plugin ID of the ContextVerity backend.
 *
 * @public
 */
export const CONTEXTVERITY_PLUGIN_ID = 'contextverity';
