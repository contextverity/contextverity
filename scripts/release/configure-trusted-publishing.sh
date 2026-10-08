#!/usr/bin/env bash
# Links every published @contextverity package to the GitHub release workflow
# (npm trusted publishing), so releases need no npm token.
#
# Run interactively by a package owner, after `npm login` (web login with 2FA;
# granular tokens that bypass 2FA are rejected by npm for this command). npm
# asks for 2FA on the first package; choose "skip 2FA for the next 5 minutes"
# in the browser so the remaining packages go through.
set -euo pipefail
NPM=(npx --yes npm@11.21.0) # `npm trust` needs npm >= 11.15
REPO="contextverity/contextverity"
WORKFLOW="release.yml"
ENVIRONMENT="npm"
PACKAGES=(
  @contextverity/plugin-contextverity-common
  @contextverity/core
  @contextverity/plugin-contextverity-node
  @contextverity/plugin-contextverity-backend
  @contextverity/plugin-contextverity
)

echo "Logged in to npm as: $("${NPM[@]}" whoami)"
for p in "${PACKAGES[@]}"; do
  if "${NPM[@]}" trust list "$p" 2>/dev/null | grep -q "$WORKFLOW"; then
    echo "== $p: already trusted"
    continue
  fi
  echo "== $p"
  "${NPM[@]}" trust github "$p" --repo "$REPO" --file "$WORKFLOW" --env "$ENVIRONMENT" --allow-publish --yes
  sleep 2
done

echo
echo "Current trusted publishers:"
for p in "${PACKAGES[@]}"; do
  echo "== $p"
  "${NPM[@]}" trust list "$p"
done
