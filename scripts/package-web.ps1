param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Release,
    [string]$EvidenceDir = 'evidence/online-package'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskRelease = Join-Path $taskRoot "dist/web/releases/$Release"
$taskManifest = Join-Path $taskRoot "dist/web/manifests/$Release.json"
$taskPackageDir = Join-Path $taskRoot 'dist/web/packages'
$taskPackage = Join-Path $taskPackageDir "valenna-$Release.zip"
if (Test-Path -LiteralPath $taskPackage) { throw 'Package exists; choose a new release. No overwrite performed.' }
& $taskNode (Join-Path $PSScriptRoot 'verify-web.cjs') --root $taskRelease --manifest $taskManifest --evidence-dir $EvidenceDir
if ($LASTEXITCODE -ne 0) { throw 'Release verification failed.' }
New-Item -ItemType Directory -Path $taskPackageDir -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($taskRelease, $taskPackage, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$taskFiles = (Get-Content -Raw -LiteralPath $taskManifest | ConvertFrom-Json).files
$taskArchive = [System.IO.Compression.ZipFile]::OpenRead($taskPackage)
try {
    if ($taskArchive.Entries.Count -ne $taskFiles.Count) { throw 'ZIP entry count mismatch.' }
    foreach ($taskFile in $taskFiles) {
        $taskEntry = $taskArchive.GetEntry($taskFile.path)
        if ($null -eq $taskEntry) { throw "Missing ZIP entry: $($taskFile.path)" }
        $taskStream = $taskEntry.Open()
        try { $taskHash = (Get-FileHash -InputStream $taskStream -Algorithm SHA256).Hash.ToLowerInvariant() }
        finally { $taskStream.Dispose() }
        if ($taskHash -ne $taskFile.sha256 -or $taskEntry.Length -ne $taskFile.bytes) { throw "ZIP byte mismatch: $($taskFile.path)" }
    }
} finally { $taskArchive.Dispose() }
$taskEvidence = if ([System.IO.Path]::IsPathRooted($EvidenceDir)) { $EvidenceDir } else { Join-Path $taskRoot $EvidenceDir }
New-Item -ItemType Directory -Path $taskEvidence -Force | Out-Null
$taskResult = [ordered]@{
    passed = $true
    release = $Release
    archive = "dist/web/packages/valenna-$Release.zip"
    bytes = (Get-Item -LiteralPath $taskPackage).Length
    sha256 = (Get-FileHash -LiteralPath $taskPackage -Algorithm SHA256).Hash.ToLowerInvariant()
    verifiedEntries = $taskFiles.Count
    indexAtArchiveRoot = $true
    allEntryHashesMatchManifest = $true
}
$taskResult | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskEvidence 'package-verification.json') -Encoding utf8
$taskResult | ConvertTo-Json
