# Validates Bambuddy changes against the same gates that break Docker/CI.
# Usage:
#   .\scripts\validate-build.ps1                      # quick: frontend build + backend lint/import
#   .\scripts\validate-build.ps1 -Mode full           # + frontend tests + backend pytest
#   .\scripts\validate-build.ps1 -Scope backend       # backend only
#   .\scripts\validate-build.ps1 -Scope frontend      # frontend only

param(
    [ValidateSet('quick', 'full')]
    [string]$Mode = 'quick',

    [ValidateSet('all', 'frontend', 'backend')]
    [string]$Scope = 'all'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

function Assert-LastExit($StepName) {
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $StepName (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

function Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Ruff {
    if (-not (Get-Command ruff -ErrorAction SilentlyContinue)) {
        Write-Host "ruff not on PATH; installing via pip..." -ForegroundColor Yellow
        python -m pip install ruff --quiet
        Assert-LastExit 'pip install ruff'
    }
}

function Test-PythonImport($Expression) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        python -c $Expression 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

function Ensure-BackendDeps {
    $needInstall = -not (Test-PythonImport 'import backend.app.main')
    if ($Mode -eq 'full' -and -not (Test-PythonImport 'import pytest')) {
        $needInstall = $true
    }
    if ($needInstall) {
        Step "backend: pip install requirements"
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        try {
            python -m pip install --upgrade pip --quiet 2>&1 | Out-Null
            Assert-LastExit 'pip upgrade'
            python -m pip install `
                -r (Join-Path $RepoRoot 'requirements.txt') `
                -r (Join-Path $RepoRoot 'requirements-dev.txt') `
                --quiet 2>&1 | Out-Null
            Assert-LastExit 'pip install requirements'
        }
        finally {
            $ErrorActionPreference = $prev
        }
    }
}

function Invoke-FrontendBuild {
    Step "frontend: npm run build"
    Push-Location (Join-Path $RepoRoot 'frontend')
    try {
        if (-not (Test-Path 'node_modules')) {
            npm ci
            Assert-LastExit 'npm ci'
        }
        npm run build
        Assert-LastExit 'frontend npm run build'
    }
    finally {
        Pop-Location
    }
}

function Invoke-FrontendLint {
    Step "frontend: npm run lint"
    Push-Location (Join-Path $RepoRoot 'frontend')
    try {
        if (-not (Test-Path 'node_modules')) {
            npm ci
            Assert-LastExit 'npm ci'
        }
        npm run lint
        Assert-LastExit 'frontend npm run lint'
    }
    finally {
        Pop-Location
    }
}

function Invoke-FrontendTests {
    Step "frontend: npm run test:run"
    Push-Location (Join-Path $RepoRoot 'frontend')
    try {
        npm run test:run
        Assert-LastExit 'frontend npm run test:run'
    }
    finally {
        Pop-Location
    }
}

function Invoke-BackendLint {
    Step "backend: ruff check + format"
    Push-Location $RepoRoot
    try {
        Ensure-Ruff
        ruff check backend/
        Assert-LastExit 'ruff check'
        ruff format --check backend/
        Assert-LastExit 'ruff format --check'
    }
    finally {
        Pop-Location
    }
}

function Invoke-BackendImportSmoke {
    Step "backend: import smoke (Docker production image check)"
    Push-Location $RepoRoot
    try {
        $env:PYTHONPATH = $RepoRoot
        python -c "import backend.app.main; print('backend import OK')"
        Assert-LastExit 'backend import'
    }
    finally {
        Pop-Location
    }
}

function Invoke-BackendTests {
    Step "backend: pytest (CI backend-tests job; may take several minutes)"
    Push-Location (Join-Path $RepoRoot 'backend')
    try {
        $env:PYTHONPATH = (Join-Path $RepoRoot '')
        $env:TESTING = '1'
        python -m pytest tests/ `
            --tb=short `
            --timeout=60 `
            --timeout-method=thread `
            -n auto `
            --maxfail=20
        Assert-LastExit 'backend pytest'
    }
    finally {
        Pop-Location
    }
}

Step "Bambuddy validate-build ($Mode, scope=$Scope) at $RepoRoot"

$runFrontend = $Scope -eq 'all' -or $Scope -eq 'frontend'
$runBackend = $Scope -eq 'all' -or $Scope -eq 'backend'

if ($runBackend) {
    $env:PYTHONPATH = $RepoRoot
    Ensure-BackendDeps
}

if ($runFrontend) {
    Invoke-FrontendBuild
}

if ($runBackend) {
    Invoke-BackendLint
    Invoke-BackendImportSmoke
}

if ($Mode -eq 'quick') {
    Write-Host ""
    Write-Host "All quick checks passed." -ForegroundColor Green
    exit 0
}

if ($runFrontend) {
    Invoke-FrontendLint
    Invoke-FrontendTests
}

if ($runBackend) {
    Invoke-BackendTests
}

Write-Host ""
Write-Host "All full checks passed." -ForegroundColor Green
