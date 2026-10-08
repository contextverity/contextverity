# Releasing

ContextVerity has not published a release yet. The intended process:

1. Ensure `main` is green (`make verify`, `make test-e2e` on the lab).
2. Regenerate results on a clean checkout of the release commit
   (`make test-results`) and commit them with the release.
3. Update `CHANGELOG.md` and package versions (`0.x.y`, all packages together).
4. Tag `vX.Y.Z` with a signed tag and create a GitHub release with the changelog.
5. Publish packages with `npm publish --provenance` from CI once npm publishing is set
   up, and attach a CycloneDX SBOM (`make sbom`).

All commits and tags are signed.
