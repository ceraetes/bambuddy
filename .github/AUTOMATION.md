# Dev image and upstream daily automation

GitHub Actions live on branch **`ceraetes/ci`** (fork default branch). Branch **`dev`** tracks **`maziggy/bambuddy` `dev`** only.

| Workflow | Trigger | Effect |
|----------|---------|--------|
| `sync-upstream-daily.yml` | Hourly + manual | When `ghcr.io/maziggy/bambuddy:daily` digest changes, merge `maziggy/bambuddy` `dev` into this fork's `dev`, update digest on `ceraetes/ci`, trigger integration build |
| `integration-build-watch.yml` | Every 10 min, `ceraetes/ci` config push, `repository_dispatch` | Compares SHAs of `dev` + integration branches; starts build when anything changed |
| `trigger-integration-build.yml` | Push on branches that contain this file | Dispatches integration build immediately (must exist on the feature branch) |
| `build-integration-dev.yml` | Manual, watch/trigger/sync dispatch | Merge `origin/dev` + branches in `.github/integration-branches` (in order), build and push `ghcr.io/ceraetes/bambuddy:dev` |
| `build-dev-image.yml` | Manual only (deprecated) | Redirects — use integration workflow |

The [homeassistant-app-bambuddy](https://github.com/ceraetes/homeassistant-app-bambuddy) repo bumps the HA add-on when `:dev` changes.

## Branch layout

| Branch | Purpose |
|--------|---------|
| `dev` | Mirrors upstream `dev` (no fork feature code) |
| `ceraetes/ci` | Fork workflows, integration config, upstream digest file |
| `feature/*` | Topic branches listed in `.github/integration-branches` |
| `backup/*` | Safety snapshots |

## Integration branches

Edit [`.github/integration-branches`](integration-branches): one branch per line, merged **top to bottom** onto `dev`.

- Put **base features first** (e.g. `feature/slicing-spoolman`).
- Put **stacked features after** their base, with `after <base-branch>` (e.g. `feature/3mf-project-overrides after feature/slicing-spoolman`).
- The build job fails if merge order is wrong (branch not based on the previous line).

After adding a branch:

1. Push the updated `integration-branches` on `ceraetes/ci`.
2. Copy [`.github/workflows/trigger-integration-build.yml`](workflows/trigger-integration-build.yml) onto the new feature branch and push (for instant rebuilds on every push). Without it, the watch workflow rebuilds within ~10 minutes.

## Why feature pushes did not rebuild before

GitHub only runs workflows that exist **on the branch that was pushed**. `build-integration-dev.yml` lives on `ceraetes/ci`, so pushes to `feature/*` did not start it unless a small trigger workflow was also on that branch.

## One-time setup

1. **Secret** `HA_REPO_PAT` on this repo — fine-grained PAT with **Contents: Read and write** on `ceraetes/homeassistant-app-bambuddy` (used for `repository_dispatch` after image push).

2. **GHCR** — Package `ghcr.io/ceraetes/bambuddy` should be **public** so Home Assistant can pull `:dev` without registry credentials.

3. **Default branch** — Set to `ceraetes/ci` so scheduled workflows run.

4. **Branch `dev`** — Allow `github-actions[bot]` to push if branch protection is enabled.

5. **Branch `ceraetes/ci`** — Allow `github-actions[bot]` to push (records `.github/integration-build-fingerprint` after each successful build).

## Manual publish

```bash
./docker-publish-dev.sh
# or: ./docker-publish-dev.sh --parallel
```

Requires `docker login ghcr.io`. For CI-equivalent builds, run **Build integration dev image** or **Integration build watch** in Actions.
