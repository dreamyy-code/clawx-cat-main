param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageJsonPath = Join-Path $rootDir 'package.json'
$entryPath = Join-Path $rootDir 'node_modules\openclaw'
$cacheDir = Join-Path $rootDir ".openclaw-cache\$Version"
$tgzPath = Join-Path $cacheDir "openclaw-$Version.tgz"
$extractDir = Join-Path $cacheDir 'extract'
$packageDir = Join-Path $extractDir 'package'
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
$downloadUrl = "https://registry.npmmirror.com/openclaw/-/openclaw-$Version.tgz"

function Remove-DirectoryRobustly {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (!(Test-Path $Path)) {
        return
    }

    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
    }

    if (Test-Path $Path) {
        try {
            $quotedPath = '"' + $Path + '"'
            & cmd.exe /d /c "rd /s /q $quotedPath" | Out-Null
        } catch {
        }
    }

    if (Test-Path $Path) {
        throw "Failed to remove directory: $Path"
    }
}

if (!(Test-Path $packageJsonPath)) {
    throw "package.json not found: $packageJsonPath"
}

if (!(Test-Path $entryPath)) {
    throw "node_modules\openclaw not found: $entryPath"
}

$packageText = [System.IO.File]::ReadAllText($packageJsonPath)
$updatedText = [System.Text.RegularExpressions.Regex]::Replace(
    $packageText,
    '"openclaw"\s*:\s*"[^"]+"',
    ('"openclaw": "' + $Version + '"')
)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($packageJsonPath, $updatedText, $utf8NoBom)

$installedTarget = (Get-Item $entryPath).Target
$installedDir = @($installedTarget | ForEach-Object { "$_" })[0]
if ([string]::IsNullOrWhiteSpace($installedDir)) {
    throw "Failed to resolve node_modules\openclaw target"
}

Remove-DirectoryRobustly -Path $cacheDir
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

Write-Host "[download] $downloadUrl"
Invoke-WebRequest -Uri $downloadUrl -OutFile $tgzPath

Write-Host "[extract] $tgzPath"
& $tarExe -xf $tgzPath -C $extractDir
if ($LASTEXITCODE -ne 0) {
    throw "tar extract failed with exit code $LASTEXITCODE"
}

if (!(Test-Path $packageDir)) {
    throw "Extracted package directory not found: $packageDir"
}

Get-ChildItem -Force $installedDir | ForEach-Object {
    if ($_.PSIsContainer) {
        Remove-DirectoryRobustly -Path $_.FullName
    } else {
        Remove-Item -LiteralPath $_.FullName -Force
    }
}
Copy-Item -Path (Join-Path $packageDir '*') -Destination $installedDir -Recurse -Force

$installedPackageJson = Get-Content (Join-Path $installedDir 'package.json') -Raw | ConvertFrom-Json
Write-Host "[package.json] openclaw -> $Version"
Write-Host "[node_modules] $installedDir"
Write-Host "[installed] openclaw@$($installedPackageJson.version)"
