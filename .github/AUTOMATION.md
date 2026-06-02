# Dev image and upstream daily automation

GitHub Actions live on branch **`ceraetes/ci`** (fork default branch). Branch **`dev`** tracks **`maziggy/bambuddy` `dev`** only.

| Workflow | Trigger | Effect |
|----------|---------|--------|
| `sync-upstream-daily.yml` | Hourly + manual | When `ghcr.io/maziggy/bambuddy:daily` digest changes, merge `maziggy/bambuddy` `dev` into this fork's `dev`, update digest on `ceraetes/ci`, trigger integration build |
| `build-integration-dev.yml` | Feature/`ceraetes/ci` push, `integration-build` dispatch, manual | Merge `origin/dev` + branches in `.github/integration-branches`, build and push `ghcr.io/ceraetes/bambuddy:dev` |
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

Edit [`.github/integration-branches`](integration-branches) (one branch per line) to add feature branches merged before the Docker build.

## One-time setup

1. **Secret** `HA_REPO_PAT` on this repo — fine-grained PAT with **Contents: Read and write** on `ceraetes/homeassistant-app-bambuddy` (used for `repository_dispatch` after image push).

2. **GHCR** — Package `ghcr.io/ceraetes/bambuddy` should be **public** so Home Assistant can pull `:dev` without registry credentials.

3. **Default branch** — Set to `ceraetes/ci` so scheduled workflows run.

4. **Branch `dev`** — Allow `github-actions[bot]` to push if branch protection is enabled.

5. **Feature work** — Push to `feature/*` branches; integration workflow builds the combined image.

## Manual publish

```bash
./docker-publish-dev.sh
# or: ./docker-publish-dev.sh --parallel
```

Requires `docker login ghcr.io`. For CI-equivalent builds, run **Build integration dev image** in Actions.
