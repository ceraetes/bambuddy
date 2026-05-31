#!/bin/bash
# Dev build: push multi-arch image to ghcr.io/ceraetes/bambuddy:dev (fork / HA add-on)
#
# Usage:
#   ./docker-publish-dev.sh [--parallel] [--with-release]
#
# Examples:
#   ./docker-publish-dev.sh              # GHCR only, no GitHub release (default)
#   ./docker-publish-dev.sh --parallel   # Build amd64 and arm64 in parallel
#   ./docker-publish-dev.sh --with-release  # Also create a dated GitHub prerelease
#
# Reads APP_VERSION from backend/app/core/config.py (any semver-like value).
# Overwrites ghcr.io/ceraetes/bambuddy:dev on each run.
#
#   docker pull ghcr.io/ceraetes/bambuddy:dev
#
# Prerequisites:
#   1. Log in to ghcr.io:
#      echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
#
#   2. Log in to Docker Hub:
#      docker login -u YOUR_USERNAME
#
#   3. GitHub CLI (gh) authenticated for creating releases
#
# Supported architectures:
#   - linux/amd64 (x86_64, most servers/desktops)
#   - linux/arm64 (Raspberry Pi 4/5, Apple Silicon via emulation)

set -e

# Configuration
GHCR_REGISTRY="ghcr.io"
DOCKERHUB_REGISTRY="docker.io"
IMAGE_NAME="ceraetes/bambuddy"
DOCKER_TAG="dev"
GHCR_IMAGE="${GHCR_REGISTRY}/${IMAGE_NAME}"
DOCKERHUB_IMAGE="${DOCKERHUB_REGISTRY}/${IMAGE_NAME}"
PLATFORMS="linux/amd64,linux/arm64"
BUILDER_NAME="bambuddy-builder"
CONFIG_FILE="backend/app/core/config.py"
CHANGELOG_FILE="CHANGELOG.md"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
PARALLEL=false
PUSH_GHCR=true
PUSH_DOCKERHUB=false
SKIP_RELEASE=true
for arg in "$@"; do
    case $arg in
        --parallel)
            PARALLEL=true
            ;;
        --with-release)
            SKIP_RELEASE=false
            ;;
        --help|-h)
            echo "Usage: $0 [--parallel] [--with-release]"
            echo ""
            echo "Build and publish ghcr.io/ceraetes/bambuddy:dev (multi-arch)."
            echo ""
            echo "Options:"
            echo "  --parallel       Build both architectures simultaneously"
            echo "  --with-release   Create/update a GitHub prerelease (off by default)"
            echo "  --help, -h       Show this help"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $arg${NC}"
            echo "Run $0 --help for usage"
            exit 1
            ;;
    esac
done

# ============================================================
# Step 1: Read and validate APP_VERSION
# ============================================================
echo -e "${BLUE}[1/4] Validating APP_VERSION...${NC}"

VERSION=$(grep -oP 'APP_VERSION = "\K[^"]+' "$CONFIG_FILE")

if [ -z "$VERSION" ]; then
    echo -e "${RED}Error: Could not read APP_VERSION from ${CONFIG_FILE}${NC}"
    exit 1
fi

# Date-stamped tag for optional GitHub releases only (not used as Docker tag)
DEV_DATE=$(date +%Y%m%d)
DEV_TAG="${VERSION}-dev.${DEV_DATE}"

echo -e "${GREEN}  APP_VERSION: ${VERSION}${NC}"
echo -e "${GREEN}  Docker tag:  ${DOCKER_TAG}${NC}"
echo -e "${GREEN}  Release tag: v${DEV_TAG}${NC}"

# ============================================================
# Step 2: Build & push Docker images
# ============================================================
echo ""

# Get CPU count
CPU_COUNT=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Dev build (ceraetes fork)${NC}"
echo -e "${GREEN}  Version:   ${VERSION}${NC}"
echo -e "${GREEN}  Docker tag: ${DOCKER_TAG}${NC}"
echo -e "${GREEN}  Platforms: ${PLATFORMS}${NC}"
echo -e "${GREEN}  CPU cores: ${CPU_COUNT}${NC}"
if [ "$PARALLEL" = true ]; then
    echo -e "${GREEN}  Mode: PARALLEL (both archs simultaneously)${NC}"
else
    echo -e "${GREEN}  Mode: Sequential (amd64 → arm64)${NC}"
fi
echo -e "${GREEN}  Registries:${NC}"
if [ "$PUSH_GHCR" = true ]; then
    echo -e "${GREEN}    - ${GHCR_IMAGE}${NC}"
fi
if [ "$PUSH_DOCKERHUB" = true ]; then
    echo -e "${GREEN}    - ${DOCKERHUB_IMAGE}${NC}"
fi
echo -e "${GREEN}================================================${NC}"
echo ""

# Check registry logins
if [ "$PUSH_GHCR" = true ]; then
    if ! grep -q "ghcr.io" ~/.docker/config.json 2>/dev/null; then
        echo -e "${YELLOW}Warning: You may not be logged in to ghcr.io${NC}"
        echo "Run: echo \$GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin"
        echo ""
    fi
fi

if [ "$PUSH_DOCKERHUB" = true ]; then
    if ! grep -q "index.docker.io\|docker.io" ~/.docker/config.json 2>/dev/null; then
        echo -e "${RED}Error: You are not logged in to Docker Hub${NC}"
        echo "Run: docker login -u YOUR_USERNAME"
        echo ""
        exit 1
    fi
fi

# Setup buildx builder if not exists
echo -e "${BLUE}[2/4] Setting up Docker Buildx and building...${NC}"
if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
    echo "Creating new buildx builder: $BUILDER_NAME (optimized for ${CPU_COUNT} cores)"
    docker buildx create \
        --name "$BUILDER_NAME" \
        --driver docker-container \
        --driver-opt network=host \
        --driver-opt "env.BUILDKIT_STEP_LOG_MAX_SIZE=10000000" \
        --buildkitd-flags "--allow-insecure-entitlement network.host --oci-worker-gc=false" \
        --config /dev/stdin <<EOF
[worker.oci]
  max-parallelism = ${CPU_COUNT}
EOF
    docker buildx inspect --bootstrap "$BUILDER_NAME"
fi
docker buildx use "$BUILDER_NAME"

# Verify builder supports multi-platform
if ! docker buildx inspect --bootstrap | grep -q "linux/arm64"; then
    echo -e "${YELLOW}Installing QEMU for cross-platform builds...${NC}"
    docker run --privileged --rm tonistiigi/binfmt --install all
fi

echo -e "${YELLOW}Tagging as '${DOCKER_TAG}' (not 'latest')${NC}"

# Build tags for all target registries
TAGS=""
if [ "$PUSH_GHCR" = true ]; then
    TAGS="$TAGS -t ${GHCR_IMAGE}:${DOCKER_TAG}"
fi
if [ "$PUSH_DOCKERHUB" = true ]; then
    TAGS="$TAGS -t ${DOCKERHUB_IMAGE}:${DOCKER_TAG}"
fi

# Common build args (no cache to ensure clean builds)
BUILD_ARGS="--provenance=false --sbom=false --no-cache --pull"

if [ "$PARALLEL" = true ]; then
    # Parallel build: Build each architecture separately then combine manifests
    echo -e "${YELLOW}Building amd64 and arm64 in parallel (${CPU_COUNT} cores each, no cache)...${NC}"

    # Build per-arch staging tags for each target registry
    ARCH_TAGS_AMD64=""
    ARCH_TAGS_ARM64=""
    if [ "$PUSH_GHCR" = true ]; then
        ARCH_TAGS_AMD64="$ARCH_TAGS_AMD64 -t ${GHCR_IMAGE}:${DOCKER_TAG}-amd64"
        ARCH_TAGS_ARM64="$ARCH_TAGS_ARM64 -t ${GHCR_IMAGE}:${DOCKER_TAG}-arm64"
    fi
    if [ "$PUSH_DOCKERHUB" = true ]; then
        ARCH_TAGS_AMD64="$ARCH_TAGS_AMD64 -t ${DOCKERHUB_IMAGE}:${DOCKER_TAG}-amd64"
        ARCH_TAGS_ARM64="$ARCH_TAGS_ARM64 -t ${DOCKERHUB_IMAGE}:${DOCKER_TAG}-arm64"
    fi

    # Build amd64 in background
    (
        echo -e "${BLUE}[amd64] Starting build...${NC}"
        docker buildx build \
            --platform linux/amd64 \
            ${ARCH_TAGS_AMD64} \
            ${BUILD_ARGS} \
            --push \
            . 2>&1 | sed 's/^/[amd64] /'
        echo -e "${GREEN}[amd64] Complete!${NC}"
    ) &
    PID_AMD64=$!

    # Build arm64 in background
    (
        echo -e "${BLUE}[arm64] Starting build...${NC}"
        docker buildx build \
            --platform linux/arm64 \
            ${ARCH_TAGS_ARM64} \
            ${BUILD_ARGS} \
            --push \
            . 2>&1 | sed 's/^/[arm64] /'
        echo -e "${GREEN}[arm64] Complete!${NC}"
    ) &
    PID_ARM64=$!

    # Wait for both builds
    echo "Waiting for parallel builds to complete..."
    wait $PID_AMD64
    wait $PID_ARM64

    # Create multi-arch manifests per registry (no cross-registry blob copies)
    echo -e "${BLUE}Creating multi-arch manifests...${NC}"

    if [ "$PUSH_GHCR" = true ]; then
        echo -e "${BLUE}  Creating GHCR manifest...${NC}"
        docker buildx imagetools create \
            -t "${GHCR_IMAGE}:${DOCKER_TAG}" \
            "${GHCR_IMAGE}:${DOCKER_TAG}-amd64" \
            "${GHCR_IMAGE}:${DOCKER_TAG}-arm64"
    fi
    if [ "$PUSH_DOCKERHUB" = true ]; then
        echo -e "${BLUE}  Creating Docker Hub manifest...${NC}"
        docker buildx imagetools create \
            -t "${DOCKERHUB_IMAGE}:${DOCKER_TAG}" \
            "${DOCKERHUB_IMAGE}:${DOCKER_TAG}-amd64" \
            "${DOCKERHUB_IMAGE}:${DOCKER_TAG}-arm64"
    fi
else
    # Sequential build (default): Build both platforms in one command
    echo -e "${YELLOW}Building sequentially with ${CPU_COUNT} cores (no cache)...${NC}"
    DOCKER_BUILDKIT=1 docker buildx build \
        --platform "$PLATFORMS" \
        ${BUILD_ARGS} \
        $TAGS \
        --push \
        .
fi

# ============================================================
# Step 3: Create/update GitHub release
# ============================================================
if [ "$SKIP_RELEASE" = true ]; then
    echo -e "${YELLOW}[3/4] Skipping GitHub release (--skip-release)${NC}"
else
    echo -e "${BLUE}[3/4] Creating/updating GitHub release...${NC}"

    # Extract release notes from CHANGELOG: content between ## [<version>] and the next ## [ heading
    CHANGELOG_NOTES=$(sed -n "/^## \[${VERSION}\]/,/^## \[/{/^## \[/!p}" "$CHANGELOG_FILE" | sed '/^$/d; 1{/^$/d}')

    # Strip @mentions so GitHub doesn't auto-generate a "Contributors" section
    CHANGELOG_NOTES=$(echo "$CHANGELOG_NOTES" | sed 's/@\([a-zA-Z0-9_-]*\)/\1/g')

    if [ -z "$CHANGELOG_NOTES" ]; then
        echo -e "${YELLOW}  Warning: No changelog notes found for ${VERSION}${NC}"
        CHANGELOG_NOTES="No changelog notes available for this release."
    fi

    # GitHub caps release body at 125000 chars. Reserve ~2000 for the boilerplate
    # header/pull-commands and truncate the changelog tail with a link to the full file.
    MAX_NOTES_LEN=122000
    if [ ${#CHANGELOG_NOTES} -gt $MAX_NOTES_LEN ]; then
        echo -e "${YELLOW}  Changelog section is ${#CHANGELOG_NOTES} chars; truncating to ${MAX_NOTES_LEN} for GitHub release body${NC}"
        CHANGELOG_NOTES="${CHANGELOG_NOTES:0:$MAX_NOTES_LEN}

---

_Changelog truncated — see the full [CHANGELOG.md](https://github.com/ceraetes/bambuddy/blob/dev/CHANGELOG.md) for the complete list._"
    fi

    # Build pull commands for the release body
    PULL_COMMANDS=""
    if [ "$PUSH_GHCR" = true ]; then
        PULL_COMMANDS="docker pull ghcr.io/ceraetes/bambuddy:dev"
    fi
    if [ "$PUSH_DOCKERHUB" = true ]; then
        if [ -n "$PULL_COMMANDS" ]; then
            PULL_COMMANDS="${PULL_COMMANDS}
# or
docker pull ceraetes/bambuddy:dev"
        else
            PULL_COMMANDS="docker pull ceraetes/bambuddy:dev"
        fi
    fi

    # Create the release body
    TODAY=$(date +%Y-%m-%d)
    RELEASE_BODY=$(cat <<EOF
> [!NOTE]
> This is a **dev build** (${TODAY}) from the ceraetes fork. It may include custom changes atop upstream daily.
>
> **Docker users:** Update by pulling the new image:
> \`\`\`
> ${PULL_COMMANDS}
> \`\`\`
>
> **Tip:** Use [Watchtower](https://containrrr.dev/watchtower/) to automatically update when new dev builds are pushed.

---

${CHANGELOG_NOTES}
EOF
    )

    # Delete ALL old dev releases — only the latest dev build should exist
    echo "  Cleaning up old dev releases..."
    OLD_DEV_RELEASES=$(gh release list --limit 100 --json tagName --jq '.[] | select(.tagName | test("-dev\\.")) | .tagName' 2>/dev/null || true)
    if [ -n "$OLD_DEV_RELEASES" ]; then
        while IFS= read -r old_tag; do
            echo "  Deleting old dev release: ${old_tag}..."
            gh release delete "$old_tag" --yes --cleanup-tag 2>/dev/null || true
        done <<< "$OLD_DEV_RELEASES"
    fi

    # Create/move tag to current HEAD and push
    echo "  Tagging current HEAD as v${DEV_TAG}..."
    git tag -f "v${DEV_TAG}"
    git push origin "v${DEV_TAG}" --force

    echo "  Creating release v${DEV_TAG}..."
    NOTES_FILE=$(mktemp)
    trap 'rm -f "$NOTES_FILE"' EXIT
    printf '%s\n' "$RELEASE_BODY" > "$NOTES_FILE"
    gh release create "v${DEV_TAG}" \
        --title "Dev Build v${DEV_TAG}" \
        --prerelease \
        --generate-notes=false \
        --notes-file "$NOTES_FILE"
    echo -e "${GREEN}  Created GitHub release: v${DEV_TAG}${NC}"
fi

# ============================================================
# Step 4: Verify
# ============================================================
echo -e "${BLUE}[4/4] Verifying...${NC}"

if [ "$PUSH_GHCR" = true ]; then
    echo -e "${BLUE}GHCR manifest:${NC}"
    docker buildx imagetools inspect "${GHCR_IMAGE}:${DOCKER_TAG}"
fi
if [ "$PUSH_DOCKERHUB" = true ]; then
    echo -e "${BLUE}Docker Hub manifest:${NC}"
    docker buildx imagetools inspect "${DOCKERHUB_IMAGE}:${DOCKER_TAG}"
fi

if [ "$SKIP_RELEASE" != true ]; then
    echo ""
    echo -e "${BLUE}GitHub release:${NC}"
    gh release view "v${DEV_TAG}"
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Dev build complete!${NC}"
echo -e "${GREEN}  Version: ${VERSION}${NC}"
echo -e "${GREEN}================================================${NC}"
if [ "$PUSH_GHCR" = true ]; then
    echo "  GHCR:       ${GHCR_IMAGE}:${DOCKER_TAG}"
fi
if [ "$PUSH_DOCKERHUB" = true ]; then
    echo "  Docker Hub: ${DOCKERHUB_IMAGE}:${DOCKER_TAG}"
fi
if [ "$SKIP_RELEASE" != true ]; then
    echo "  Release:    https://github.com/${IMAGE_NAME}/releases/tag/v${DEV_TAG}"
fi
echo ""
echo -e "${BLUE}Supported platforms:${NC}"
echo "  - linux/amd64 (Intel/AMD servers, desktops)"
echo "  - linux/arm64 (Raspberry Pi 4/5, Apple Silicon)"
echo ""
echo -e "${GREEN}Users can now run:${NC}"
if [ "$PUSH_GHCR" = true ]; then
    echo "  docker pull ${GHCR_IMAGE}:${DOCKER_TAG}"
fi
if [ "$PUSH_DOCKERHUB" = true ]; then
    echo "  docker pull ${DOCKERHUB_IMAGE}:${DOCKER_TAG}"
    echo "  docker pull ${IMAGE_NAME}:${DOCKER_TAG}  # shorthand"
fi
