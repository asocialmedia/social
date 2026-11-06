#### _<div align="left"><sub>// Contribution in asocialmedia</sub></div>_

Thank you for your interest in contributing to asocialmedia! This guide will help you start contributing to our community-driven platform.

## TABLE OF CONTENTS

1. [Making Contributions](#-making-contributions)
2. [Code Standards](#-code-standards)
3. [Troubleshooting](#-troubleshooting)
4. [Community Guidelines](#-community-guidelines)

#### _<div align="left"><sub>// Making Contributions</sub></div>_

##### _<div align="left"><sub>// Workflow</sub></div>_

```sh
1. Fork the repository
2. Clone the forked repository
3. Create a new branch (git checkout -b feature/branch-name)
4. Make changes
5. Format changes (bun run check)
6. Commit changes (git commit -am 'feat[SOME]: Some changes')
7. Push changes (git push origin feature/branch-name)
8. Create a pull request

```

##### _<div align="left"><sub>// Development Commands</sub></div>_

```sh
# Start development server
bun run docker:dev && bun run dev
```

```sh
# Formatting check
bun run check
```

```sh
# Type check
bun run check-types
```

##### _<div align="left"><sub>// Tests</sub></div>_

Pre-commit runs formatting, lint, and cached workspace type checks with at most two type-check processes. Pre-push runs unit tests for the changed workspaces and their transitive consumers, plus tooling and repository policy checks, using at most two worker processes. Lefthook supplies the committed, unpushed paths through `{push_files}`. Documentation-only pushes skip tests; root config, lockfile, patches, and test-runner changes run all unit tests.

Push checks read `test-timings.json` to schedule slower files earlier without rewriting it. Both CI shards receive the same timings snapshot; their disjoint measurements are merged and cached only after both succeed.

Run `bun scripts/testing/run-affected-tests.ts apps/mobile/src/lib/network/http-get.ts` to check a specific change locally. Run `bun run test --unit --parallel=2` for all unit tests with limited parallelism. `bun run test` defaults to two workers and keeps the complete suite available, including integration tests when PostgreSQL and Redis are reachable. Run `bun run test --integration` for a strict integration-only check with one isolated worker. CI runs lint/types, then two unit-test shards with two workers each and a separate PostgreSQL/Redis integration job. The existing required quality check waits for all of them. Integration files run serially with isolation and fail if either service is unavailable; explicitly opt-in audit, browser and scale cases still need their documented environment flags. Tests named `.integration.test.ts` are excluded from the push hook; other tests may still need Redis, ffmpeg, or local test servers.

The selector uses workspace manifests. Keep shared dependencies declared so transitive consumers are included. CI remains the full-suite gate for cross-workspace behavior.

Automatic root and lockfile workspace version stamps are compared against the upstream merge base and do not force a global run. Actual dependency, resolution, configuration, or workspace changes still do. The pre-push input must confirm that the pushed source and destination match the tracked comparison. Unknown destinations, new branches, multiple-ref pushes, and branches without an upstream retain the conservative global fallback.

#### _<div align="left"><sub>// Code Standards</sub></div>_

##### _<div align="left"><sub>// Style rules</sub></div>_

- Use TypeScript
- Follow Oxlint config
- Keep files focused
- Comment complex logic
- Use meaningful names

##### _<div align="left"><sub>// Commit messages</sub></div>_

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code change
- `test`: Adding tests
- `chore`: Maintenance
- `perf`: Performance
- `ci`: Continuous integration
- `build`: Build system
- `revert`: Revert changes
- `wip`: Work in progress

example: `feat[MODULE]: Add new module`

#### _<div align="left"><sub>// Troubleshooting</sub></div>_

**Having trouble?** [Open an issue](https://github.com/asocialmedia/social/issues)

#### _<div align="left"><sub>// Community Guidelines</sub></div>_

##### _<div align="left"><sub>// Code of Conduct</sub></div>_

- Be respectful
- Stay on topic
- Help others
- Follow code of conduct

##### _<div align="left"><sub>// Reporting Issues</sub></div>_

- Check existing issues
- Provide reproduction
- Be specific
- Follow templates & labels
- Include logs or screenshots if needed

##### _<div align="left"><sub>// Pull Requests</sub></div>_

- Link related issues
- Describe changes
- Update docs

Thank you for contributing to asocialmedia!
