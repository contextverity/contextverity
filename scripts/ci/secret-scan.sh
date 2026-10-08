#!/usr/bin/env bash
# Scans the full git history with the gitleaks CLI (MIT). The binary is
# downloaded from the official release and verified against a pinned SHA-256.
set -euo pipefail
VERSION=8.30.1
SHA256_LINUX_X64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
if ! command -v gitleaks >/dev/null; then
  if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
    echo "install gitleaks ${VERSION} locally (https://github.com/gitleaks/gitleaks)"; exit 1
  fi
  tmp="$(mktemp -d)"
  curl -sSfL -o "$tmp/gitleaks.tgz" "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz"
  echo "${SHA256_LINUX_X64}  $tmp/gitleaks.tgz" | sha256sum -c -
  tar -xzf "$tmp/gitleaks.tgz" -C "$tmp" gitleaks
  PATH="$tmp:$PATH"
fi
gitleaks git --redact --no-banner --exit-code 1 .
