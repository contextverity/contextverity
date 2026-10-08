# Permissions

## What is evaluated

For every source in a receipt, ContextVerity evaluates the Backstage permission
`catalog.entity.read` (`@backstage/plugin-catalog-common/alpha`) against the entity
behind it, with the **caller's own credentials**, through `coreServices.permissions`.

- At **resolve**, the subject is authorized _before_ it is read; related sources (for
  example provided APIs) are authorized after. Any DENY refuses the resolve
  (`PERMISSION_DENIED`).
- At **verify**, every source is authorized again for the consumer. Any DENY →
  `PERMISSION_REVOKED` → `DENY`. Issue-time decisions are recorded for audit but never
  reused.

Each decision is recorded as `{permission, resourceRef, sourceId, result, principal, basis}`.

## Why source state is read separately

The catalog filters out entities the caller may not read, returning "not found". If
ContextVerity read sources with the caller's credentials it could not tell
"revoked" from "deleted". It therefore reads source state with the plugin's own
service credentials and evaluates the caller's access explicitly, so `PERMISSION_REVOKED`
and `SOURCE_DELETED` are distinct (scenarios S10, S16, S31).

## Conditional decisions

Permission policies commonly return conditional decisions for catalog entities
(for example "readable unless restricted"). Because ContextVerity calls
`permissions.authorize` with a `resourceRef`, Backstage resolves those conditions
against the entity and returns ALLOW or DENY. The lab's permission policy revokes
access this way (`packages/backend/src/lab/permissionPolicyModule.ts`).

## Service principals

Backstage's permission client returns ALLOW for service principals without
consulting the permission policy (only external-access `accessRestrictions` can deny).
ContextVerity records such decisions with `basis: service-principal` so the receipt is
honest about how they were reached (scenario S50). To revoke a service consumer,
remove it from the context policy (`POLICY_NARROWED`, S42) or use
`accessRestrictions`.

## ContextVerity's own permission

`contextverity.receipt.read` (basic permission, registered via
`coreServices.permissionsRegistry`) allows listing all receipts, reading receipts
issued to others, and running operator drift checks. Without it, callers see only
their own receipts.
