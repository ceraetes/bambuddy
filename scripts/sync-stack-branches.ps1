# Sync child feature branches when a parent branch in .github/integration-branches moves.
# Reads stack relationships from origin/ceraetes/ci (same source as CI merge order).
param(
    [Parameter(Mandatory = $true)]
    [string]$ParentBranch,
    [switch]$Rebase,
    [switch]$WhatIf,
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

# Git writes progress to stderr; do not treat that as a terminating error.
$ErrorActionPreference = "Continue"

function Get-IntegrationLines {
    param([string]$Root)
    $raw = git -C $Root show "origin/ceraetes/ci:.github/integration-branches" 2>$null
    if (-not $raw) {
        throw "Could not read origin/ceraetes/ci:.github/integration-branches. Run: git fetch origin ceraetes/ci"
    }
    return $raw -split "`n"
}

function Get-StackMap {
    param([string[]]$Lines)
    $children = @{}
    foreach ($line in $Lines) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith("#")) { continue }
        if ($t -match '^(\S+)\s+after\s+(\S+)') {
            $child = $Matches[1]
            $parent = $Matches[2]
            if (-not $children.ContainsKey($parent)) {
                $children[$parent] = [System.Collections.Generic.List[string]]::new()
            }
            $children[$parent].Add($child)
        }
    }
    return $children
}

function Test-BranchBehindParent {
    param([string]$Root, [string]$Child, [string]$Parent)
    $mergeBase = git -C $Root merge-base "origin/$Parent" "origin/$Child" 2>$null
    if (-not $mergeBase) { return $true }
    $parentTip = git -C $Root rev-parse "origin/$Parent"
    return ($mergeBase -ne $parentTip)
}

function Sync-OneChild {
    param(
        [string]$Root,
        [string]$Child,
        [string]$Parent,
        [bool]$UseRebase,
        [bool]$DryRun
    )
    if (-not (Test-BranchBehindParent -Root $Root -Child $Child -Parent $Parent)) {
        Write-Host "OK  $Child already includes origin/$Parent"
        return $true
    }

    $mode = if ($UseRebase) { "rebase" } else { "merge" }
    Write-Host "SYNC $Child from origin/$Parent ($mode)"
    if ($DryRun) { return $true }

    git -C $Root fetch origin $Parent, $Child 2>&1 | Out-Host
    git -C $Root checkout $Child 2>&1 | Out-Host

    if ($UseRebase) {
        git -C $Root rebase "origin/$Parent" 2>&1 | Out-Host
    } else {
        git -C $Root merge "origin/$Parent" --no-edit 2>&1 | Out-Host
    }

    if ($LASTEXITCODE -ne 0) {
        $cont = if ($UseRebase) { "rebase --continue" } else { "commit" }
        Write-Host "FAILED $Child - resolve conflicts, then: git add ... ; git $cont ; git push origin $Child"
        return $false
    }

    git -C $Root push origin $Child 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED push for $Child"
        return $false
    }
    Write-Host "DONE $Child pushed"
    return $true
}

function Sync-Descendants {
    param(
        [string]$Root,
        [string]$Parent,
        [hashtable]$StackMap,
        [bool]$UseRebase,
        [bool]$DryRun
    )
    if (-not $StackMap.ContainsKey($Parent)) { return $true }
    $ok = $true
    foreach ($child in $StackMap[$Parent]) {
        if (-not (Sync-OneChild -Root $Root -Child $child -Parent $Parent -UseRebase $UseRebase -DryRun $DryRun)) {
            $ok = $false
            continue
        }
        if (-not $DryRun) {
            git -C $Root fetch origin $child 2>&1 | Out-Null
        }
        if (-not (Sync-Descendants -Root $Root -Parent $child -StackMap $StackMap -UseRebase $UseRebase -DryRun $DryRun)) {
            $ok = $false
        }
    }
    return $ok
}

Push-Location $RepoRoot
try {
    git -C $RepoRoot fetch origin ceraetes/ci 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "git fetch origin ceraetes/ci failed (exit $LASTEXITCODE)" }
    $stackMap = Get-StackMap -Lines (Get-IntegrationLines -Root $RepoRoot)
    if (-not $stackMap.ContainsKey($ParentBranch)) {
        Write-Host "No stacked children for $ParentBranch in integration-branches"
        exit 0
    }

    $children = $stackMap[$ParentBranch] -join ", "
    Write-Host "Parent: $ParentBranch -> children: $children"

    if (Sync-Descendants -Root $RepoRoot -Parent $ParentBranch -StackMap $stackMap -UseRebase:$Rebase.IsPresent -DryRun:$WhatIf.IsPresent) {
        exit 0
    }
    exit 1
} finally {
    Pop-Location
}
