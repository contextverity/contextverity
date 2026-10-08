# Governance

ContextVerity is an early-stage, independent open-source project. Its governance is
deliberately simple and will evolve as the community grows.

## Roles

- **Maintainers** review and merge changes, triage issues and security reports, and
  cut releases. The current maintainers are listed in [MAINTAINERS.md](MAINTAINERS.md).
- **Contributors** are anyone who opens an issue, reviews a change or submits a pull
  request.

## Decisions

- Day-to-day decisions are made through pull-request review. A change needs approval
  from at least one maintainer who is not its author, once more than one maintainer
  exists.
- Changes to verdict semantics, the receipt schema, or the security model are
  recorded as Architecture Decision Records in [docs/adr/](docs/adr/) and stay open
  for comment for at least one week.
- Disagreements are resolved by discussion; if that fails, maintainers decide by
  simple majority.

## Becoming a maintainer

Contributors with a sustained record of high-quality contributions and reviews may be
nominated by a maintainer and added by consensus of existing maintainers.

## Neutrality

ContextVerity is vendor-, cloud- and model-neutral. It must remain usable without
any proprietary service, and new runtime dependencies should prefer projects
governed by neutral open-source foundations.

## Changes to this document

Changes to governance are made by pull request and require approval from all
active maintainers.
