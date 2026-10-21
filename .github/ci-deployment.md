# Blacksmith CI and regional protocols deployment

CI uses only Blacksmith Ubuntu 24.04 x64 2-vCPU runners, matching the base unit of its 3,000 free minutes per organization per month. The Blacksmith GitHub App must remain enabled for this repository. This allowance is shared across the organization; workflow YAML cannot enforce an account billing cap. Confirm the account permits free-only usage before activation. Account billing settings could not be verified because the dashboard required sign-in; this migration has not changed them.

Docker builds use the pinned official Docker Buildx and build/push actions with GitHub Actions layer caches scoped per application. Blacksmith's paid persistent Docker cache, sticky disks, and static IP add-ons are not requested by these workflows. Existing amd64/arm64 publication is retained through QEMU. BuildKit cache mounts are not persisted across runs by the GitHub cache exporter. Speedups and cache hits must be measured after CI runs; this change does not introduce native ARM builders.

Official Actions cache steps use Blacksmith's colocated backend automatically, with its documented free cache allowance. Docker's `type=gha` cache continues to use GitHub's cache backend and its repository quota. No paid cache quota increase is configured. Bun and node_modules keys include runner architecture and Bun version. Turbo and Prisma caches include dependency scope; Android retains setup-gradle's cache management.

After successful protocols image publication on `main`, CI triggers both the primary protocols application and US East. US East is still attempted if the primary deploy request fails. Missing regional configuration fails the release rather than silently skipping it. Both applications must use the Docker provider and pull `ghcr.io/asocialmedia/asm-protocols:latest`.

Primary deployment uses existing `DOKPLOY_API_URL`, `DOKPLOY_API_TOKEN`, and `DOKPLOY_PROTOCOLS_APP_ID` secrets. US East uses independent repository secrets:

- `DOKPLOY_US_EAST_API_URL`
- `DOKPLOY_US_EAST_API_TOKEN`
- `DOKPLOY_US_EAST_PROTOCOLS_APP_ID`

The **Deploy Protocols Regions** workflow provides manual deployment of `primary`, `us-east`, or `all`, plus `check_only` to validate credentials and image targets without deploying. It runs only from `main`, redeploys the published `latest` image, and does not build images. API acceptance is not a readiness guarantee; Dokploy container health checks govern rollout.

```sh
gh workflow run deploy-protocols.yml --ref main -f region=all -F check_only=true
gh workflow run deploy-protocols.yml --ref main -f region=us-east
```

Sources checked for this migration:

- https://docs.blacksmith.sh/introduction/quickstart
- https://docs.blacksmith.sh/blacksmith-runners/overview
- https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions
- https://docs.blacksmith.sh/blacksmith-caching/docker-builds
- https://www.blacksmith.sh/pricing
- https://docs.docker.com/build/ci/github-actions/cache/
- https://docs.dokploy.com/docs/core/auto-deploy
- https://docs.dokploy.com/docs/api/application
