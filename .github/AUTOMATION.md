# Dev image and upstream daily automation

GitHub Actions in this repo:

| Workflow | Trigger | Effect |
|----------|---------|--------|
| `sync-upstream-daily.yml` | Hourly + manual | When `ghcr.io/maziggy/bambuddy:daily` digest changes, merge `maziggy/bambuddy` `dev` into this fork's `dev` |
| `build-dev-image.yml` | Push to `dev` + manual | Build and push `ghcr.io/ceraetes/bambuddy:dev` (multi-arch) |

The [homeassistant-app-bambuddy](https://github.com/ceraetes/homeassistant-app-bambuddy) repo bumps the HA add-on when `:dev` changes.

## One-time setup

1. **Secret** `HA_REPO_PAT` on this repo — fine-grained PAT with **Contents: Read and write** on `ceraetes/homeassistant-app-bambuddy` (used for `repository_dispatch` after image push).

2. **GHCR** — Package `ghcr.io/ceraetes/bambuddy` should be **public** so Home Assistant can pull `:dev` without registry credentials.

3. **Branch `dev`** — Allow `github-actions[bot]` to push if branch protection is enabled.

4. **Push your work** — CI only builds commits on `origin/dev`. Commit and push local changes before expecting them in the image.

## Manual publish

```bash
./docker-publish-dev.sh
# or: ./docker-publish-dev.sh --parallel
```

Requires `docker login ghcr.io`.
