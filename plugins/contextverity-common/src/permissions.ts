/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPermission } from '@backstage/plugin-permission-common';

/**
 * Read receipts issued to other consumers (list, detail, drift inspection).
 * A consumer verifying its own receipt does not need it.
 *
 * @public
 */
export const contextverityReceiptReadPermission = createPermission({
  name: 'contextverity.receipt.read',
  attributes: { action: 'read' },
});

/** @public */
export const contextverityPermissions = [contextverityReceiptReadPermission];
