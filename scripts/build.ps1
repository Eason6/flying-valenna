param(
    [ValidateSet('offline','online')][string]$Target = 'offline',
    [string]$Release,
    [string]$EvidenceDir = 'evidence/online-build'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = (Get-Command node -ErrorAction Stop).Source
Push-Location -LiteralPath $taskRoot
try {
    $taskBuildArgs = @('scripts/build.cjs', '--target', $Target)
    if ($Target -eq 'online') {
        if (-not $Release) { throw 'Online build requires -Release with a new release name.' }
        $taskBuildArgs += @('--release', $Release)
    }
    & $taskNode @taskBuildArgs
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    if ($Target -eq 'online') {
        & $taskNode 'scripts/verify-web.cjs' '--root' "dist/web/releases/$Release" '--manifest' "dist/web/manifests/$Release.json" '--evidence-dir' $EvidenceDir
    } else {
        & $taskNode 'scripts/verify-bundle.cjs' '--evidence-dir' $EvidenceDir
    }
    if ($LASTEXITCODE -ne 0) { throw 'Bundle verification failed.' }
} finally {
    Pop-Location
}
