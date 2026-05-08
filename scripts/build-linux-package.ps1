param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("arm64", "x64")]
    [string]$Arch,

    [string]$Version,

    [string[]]$Targets = @("deb"),

    [string]$OpenClawTrack = "all",

    [switch]$SingleTrackMode
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$OpenClawBuildsPath = Join-Path $RepoRoot "openclaw-builds.json"
$RubyDefault = "C:\Ruby34-x64\bin\ruby.exe"

function Fail {
    param([string]$Message)
    Write-Host "[Error] $Message" -ForegroundColor Red
    exit 1
}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function ConvertTo-PrettyJson {
    param([Parameter(Mandatory = $true)]$InputObject)

    return ($InputObject | ConvertTo-Json -Depth 100)
}

function Write-BuildProfile {
    param(
        [Parameter(Mandatory = $true)][string]$Variant,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][string]$IterativeCatBaseUrl,
        [Parameter(Mandatory = $true)][string]$UpdateBaseUrl,
        [Parameter(Mandatory = $false)][string]$UpdateTrack = "",
        [Parameter(Mandatory = $true)][string]$OpenClawTrack,
        [Parameter(Mandatory = $true)][string]$OpenClawVersion
    )

    $buildProfilePath = Join-Path $RepoRoot "build-profile.json"
    $profile = [ordered]@{
        variant = $Variant
        displayName = $DisplayName
        iterativeCatBaseUrl = $IterativeCatBaseUrl
        updateBaseUrl = $UpdateBaseUrl
        updateTrack = $UpdateTrack
        openclawTrack = $OpenClawTrack
        openclawVersion = $OpenClawVersion
    }

    Write-Utf8NoBom -Path $buildProfilePath -Content (ConvertTo-PrettyJson -InputObject $profile)
    Write-Host "[build-profile] ${DisplayName}: iterativecat=$IterativeCatBaseUrl, update=$UpdateBaseUrl, track=$UpdateTrack, openclaw=$OpenClawTrack@$OpenClawVersion"
}

function New-GenericLinuxMetadata {
    param(
        [Parameter(Mandatory = $true)][string]$BuildOutputDir,
        [Parameter(Mandatory = $true)][string]$PackageUrl,
        [Parameter(Mandatory = $true)][string]$Version
    )

    $tarball = Get-ChildItem -Path $BuildOutputDir -Filter "*.tar.gz" -File | Select-Object -First 1
    if (-not $tarball) {
        Fail "Generic Linux tar.gz artifact not found in $BuildOutputDir"
    }

    $sha256 = (Get-FileHash -Algorithm SHA256 -Path $tarball.FullName).Hash.ToLowerInvariant()
    $releaseDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $metadata = [ordered]@{
        version = $Version
        url = $PackageUrl
        sha256 = $sha256
        releaseDate = $releaseDate
    }

    $metadataPath = Join-Path $BuildOutputDir "latest.json"
    Write-Utf8NoBom -Path $metadataPath -Content (ConvertTo-PrettyJson -InputObject $metadata)
    Write-Host "[artifact] Generated generic Linux metadata: $metadataPath"
    Write-Host "          url=$PackageUrl"
    Write-Host "          sha256=$sha256"
}

function Copy-LinuxSupportScripts {
    param(
        [Parameter(Mandatory = $true)][string]$BuildOutputDir
    )

    $scriptsToCopy = @(
        @{
            Source = Join-Path $RepoRoot "scripts\linux\clawx-update.sh"
            Target = "clawx-update.sh"
        },
        @{
            Source = Join-Path $RepoRoot "start_clawx_headless.sh"
            Target = "start_clawx_headless.sh"
        },
        @{
            Source = Join-Path $RepoRoot "set_clawx_bridge_token.sh"
            Target = "set_clawx_bridge_token.sh"
        },
        @{
            Source = Join-Path $RepoRoot "clawx-uninstall.sh"
            Target = "clawx-uninstall.sh"
        }
    )

    foreach ($item in $scriptsToCopy) {
        if (-not (Test-Path $item.Source)) {
            Fail "Required Linux support script not found: $($item.Source)"
        }

        $targetPath = Join-Path $BuildOutputDir $item.Target
        Copy-Item -Force $item.Source $targetPath
        Write-Host "[artifact] Copied support script: $($item.Target)"
    }
}

function Ensure-FileExists {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not (Test-Path $Path)) {
        Fail "$Label not found: $Path"
    }
}

function Verify-LinuxUpdateMetadata {
    param(
        [Parameter(Mandatory = $true)][string]$BuildOutputDir,
        [Parameter(Mandatory = $true)][bool]$IsGenericTrack,
        [Parameter(Mandatory = $true)][string]$TrackId,
        [Parameter(Mandatory = $true)][string]$Arch
    )

    if ($IsGenericTrack) {
        $metadataPath = Join-Path $BuildOutputDir "latest.json"
        Ensure-FileExists -Path $metadataPath -Label "Generic Linux update metadata for $TrackId"
        Write-Host "[metadata] Generic Linux update metadata ready: $metadataPath"
        return
    }

    $metadataFileName = if ($Arch -eq "arm64") { "latest-linux-arm64.yml" } else { "latest-linux.yml" }
    $metadataPath = Join-Path $BuildOutputDir $metadataFileName
    Ensure-FileExists -Path $metadataPath -Label "Linux deb update metadata for $TrackId"
    Write-Host "[metadata] Linux deb update metadata ready: $metadataPath"
}

function Resolve-BuildOutputDir {
    param([Parameter(Mandatory = $true)][string]$PreferredPath)

    if (-not (Test-Path $PreferredPath)) {
        return $PreferredPath
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $candidate = "$PreferredPath-rerun-$timestamp"
    Write-Host "[Note] Output directory already exists. Using a fresh directory:"
    Write-Host "       $candidate"
    return $candidate
}

function Read-OpenClawBuildConfig {
    if (-not (Test-Path $OpenClawBuildsPath)) {
        Fail "Missing OpenClaw build config: $OpenClawBuildsPath"
    }

    $config = Get-Content -Raw -Path $OpenClawBuildsPath | ConvertFrom-Json
    if (-not $config.tracks -or $config.tracks.Count -eq 0) {
        Fail "openclaw-builds.json must define at least one track."
    }

    $tracks = @()
    foreach ($track in $config.tracks) {
        $id = [string]$track.id
        $openclawVersion = [string]$track.openclawVersion
        if ([string]::IsNullOrWhiteSpace($id) -or [string]::IsNullOrWhiteSpace($openclawVersion)) {
            Fail "Invalid OpenClaw track config entry in openclaw-builds.json"
        }

        $displayName = [string]$track.displayName
        if ([string]::IsNullOrWhiteSpace($displayName)) {
            $displayName = $id
        }

        $artifactSuffix = [string]$track.artifactSuffix
        if ([string]::IsNullOrWhiteSpace($artifactSuffix)) {
            $artifactSuffix = $id
        }

        $updatePath = [string]$track.updatePath
        if ([string]::IsNullOrWhiteSpace($updatePath)) {
            $updatePath = $artifactSuffix
        }

        $tracks += [pscustomobject]@{
            id = $id.Trim()
            displayName = $displayName.Trim()
            openclawVersion = $openclawVersion.Trim()
            artifactSuffix = $artifactSuffix.Trim()
            updatePath = $updatePath.Trim()
        }
    }

    $defaultTrackId = [string]$config.defaultTrack
    if ([string]::IsNullOrWhiteSpace($defaultTrackId)) {
        $defaultTrackId = $tracks[0].id
    }

    $defaultTrack = $tracks | Where-Object { $_.id -eq $defaultTrackId.Trim() } | Select-Object -First 1
    if (-not $defaultTrack) {
        Fail "Unknown defaultTrack '$defaultTrackId' in openclaw-builds.json"
    }

    return [pscustomobject]@{
        defaultTrack = $defaultTrack
        tracks = $tracks
    }
}

function Resolve-OpenClawTracks {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$RequestedTrack
    )

    if ([string]::IsNullOrWhiteSpace($RequestedTrack) -or $RequestedTrack -eq "all") {
        return @($Config.tracks)
    }

    $track = $Config.tracks | Where-Object { $_.id -eq $RequestedTrack } | Select-Object -First 1
    if (-not $track) {
        $available = ($Config.tracks | ForEach-Object { $_.id }) -join ", "
        Fail "Unknown OpenClaw track '$RequestedTrack'. Available values: all, $available"
    }

    return @($track)
}

function Set-OpenClawVersion {
    param(
        [Parameter(Mandatory = $true)][string]$OpenClawVersion,
        [Parameter(Mandatory = $true)][string]$TrackDisplayName
    )

    Write-Host "[OpenClaw] Switching to $TrackDisplayName ($OpenClawVersion)..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot "scripts\update-openclaw.ps1") -Version $OpenClawVersion
    if ($LASTEXITCODE -ne 0) {
        Fail "Failed to switch OpenClaw to version $OpenClawVersion"
    }
}

function Resolve-Ruby {
    if (Test-Path $RubyDefault) {
        return (Resolve-Path $RubyDefault).Path
    }

    $ruby = Get-Command ruby -ErrorAction SilentlyContinue
    if ($ruby) {
        return $ruby.Source
    }

    return $null
}

function Ensure-Command {
    param([string]$Name, [string]$Message)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail $Message
    }
}

function Resolve-Targets {
    param([string[]]$RawTargets)

    $allowedTargets = @("deb", "rpm", "AppImage", "tar.gz")
    $resolvedTargets = New-Object System.Collections.Generic.List[string]

    foreach ($rawTarget in $RawTargets) {
        if ([string]::IsNullOrWhiteSpace($rawTarget)) {
            continue
        }

        foreach ($candidate in ($rawTarget -split ',')) {
            $trimmed = $candidate.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) {
                continue
            }

            if ($allowedTargets -notcontains $trimmed) {
                Fail "Unsupported Linux target: $trimmed. Supported values: $($allowedTargets -join ', ')"
            }

            if (-not $resolvedTargets.Contains($trimmed)) {
                $resolvedTargets.Add($trimmed)
            }
        }
    }

    if ($resolvedTargets.Count -eq 0) {
        Fail "At least one Linux target must be specified."
    }

    return $resolvedTargets
}

function Normalize-TargetsForHost {
    param([System.Collections.Generic.List[string]]$ResolvedTargets)

    if ($env:OS -eq "Windows_NT" -and $ResolvedTargets.Contains("rpm")) {
        [void]$ResolvedTargets.Remove("rpm")
        Write-Host "[Note] Skipping rpm target on Windows: rpmbuild is required and is not available in this build environment."
    }

    if ($ResolvedTargets.Count -eq 0) {
        Fail "No supported Linux targets remain for the current host."
    }

    return $ResolvedTargets
}

function Invoke-NodeDownload {
    param(
        [string[]]$Urls,
        [string]$OutFile
    )

    $downloader = @'
const fs = require('fs');
const http = require('http');
const https = require('https');

const output = process.argv[2];
const urls = process.argv.slice(3);

function download(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        resolve(download(next));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const file = fs.createWriteStream(output);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  for (const url of urls) {
    try {
      if (fs.existsSync(output)) {
        fs.unlinkSync(output);
      }
      await download(url);
      process.exit(0);
    } catch (error) {
      console.error(String(error.message || error));
    }
  }
  process.exit(1);
})();
'@

    $scriptPath = Join-Path $RepoRoot "temp-download.js"
    Write-Utf8NoBom -Path $scriptPath -Content $downloader

    try {
        & node $scriptPath $OutFile @Urls
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $OutFile)) {
            Fail "Failed to download required file."
        }
    } finally {
        Remove-Item -Force $scriptPath -ErrorAction SilentlyContinue
    }
}

function Ensure-UvBinary {
    param([string]$TargetArch)

    switch ($TargetArch) {
        "arm64" {
            $resourceDir = Join-Path $RepoRoot "resources\bin\linux-arm64"
            $archiveName = "uv-linux-arm64.tar.gz"
            $archiveFile = "uv-aarch64-unknown-linux-gnu.tar.gz"
            $extractDir = "uv-aarch64-unknown-linux-gnu"
        }
        "x64" {
            $resourceDir = Join-Path $RepoRoot "resources\bin\linux-x64"
            $archiveName = "uv-linux-x64.tar.gz"
            $archiveFile = "uv-x86_64-unknown-linux-gnu.tar.gz"
            $extractDir = "uv-x86_64-unknown-linux-gnu"
        }
        default {
            Fail "Unsupported Linux arch: $TargetArch"
        }
    }

    $uvPath = Join-Path $resourceDir "uv"
    if (Test-Path $uvPath) {
        return
    }

    Write-Host "[Setup] $TargetArch uv not found. Downloading..."

    $archivePath = Join-Path $RepoRoot $archiveName
    $urls = @(
        "https://downloads.sourceforge.net/project/uv-project-manager.mirror/0.10.0/$archiveFile",
        "https://github.com/astral-sh/uv/releases/download/0.10.0/$archiveFile"
    )

    Invoke-NodeDownload -Urls $urls -OutFile $archivePath

    try {
        New-Item -ItemType Directory -Force -Path $resourceDir | Out-Null
        & tar -xzf $archivePath
        if ($LASTEXITCODE -ne 0) {
            Fail "Failed to extract $archiveFile."
        }

        $extractedBinary = Join-Path (Join-Path $RepoRoot $extractDir) "uv"
        Copy-Item -Force $extractedBinary $uvPath
    } finally {
        Remove-Item -Recurse -Force (Join-Path $RepoRoot $extractDir) -ErrorAction SilentlyContinue
        Remove-Item -Force $archivePath -ErrorAction SilentlyContinue
    }
}

function Ensure-FpmBridge {
    $file = Join-Path $RepoRoot "node_modules\app-builder-lib\out\targets\FpmTarget.js"
    if (-not (Test-Path $file)) {
        Fail "Unable to locate $file"
    }

    $text = Get-Content -Raw -Path $file
    if ($text -match "process\.env\.RUBY_FPM_RUBY") {
        return
    }

    $old = @"
const fpmPath = await (0, linux_1.getFpmPath)();
        await (0, builder_util_1.exec)(fpmPath, fpmArgs, { env }).catch(e => {
"@

    $new = @"
const fpmPath = await (0, linux_1.getFpmPath)();
        const command = process.platform === "win32" ? (process.env.RUBY_FPM_RUBY || "ruby") : fpmPath;
        const commandArgs = process.platform === "win32" ? [fpmPath, ...fpmArgs] : fpmArgs;
        await (0, builder_util_1.exec)(command, commandArgs, { env }).catch(e => {
"@

    if (-not $text.Contains($old)) {
        Fail "Unable to patch node_modules/app-builder-lib/out/targets/FpmTarget.js"
    }

    $text = $text.Replace($old, $new)
    Write-Utf8NoBom -Path $file -Content $text
}

Ensure-Command -Name "node" -Message "Node.js not found. Please install Node.js 18+"
Ensure-Command -Name "pnpm" -Message "pnpm not found. Please install pnpm first."

$openClawBuildConfig = Read-OpenClawBuildConfig
$resolvedOpenClawTracks = Resolve-OpenClawTracks -Config $openClawBuildConfig -RequestedTrack $OpenClawTrack

if (-not $SingleTrackMode -and $resolvedOpenClawTracks.Count -gt 1) {
    Push-Location $RepoRoot
    try {
        foreach ($track in $resolvedOpenClawTracks) {
            Write-Host
            Write-Host "========================================"
            Write-Host "ClawX - Linux dual track build"
            Write-Host "========================================"
            Write-Host "Track: $($track.displayName) / openclaw@$($track.openclawVersion)"
            Write-Host

            $childArgs = @(
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                $PSCommandPath,
                "-Arch",
                $Arch,
                "-OpenClawTrack",
                $track.id,
                "-SingleTrackMode"
            )

            foreach ($target in $Targets) {
                $childArgs += @("-Targets", $target)
            }

            if ($Version) {
                $childArgs += @("-Version", $Version)
            }

            & powershell @childArgs
            if ($LASTEXITCODE -ne 0) {
                Fail "Linux $Arch build failed for track $($track.id)"
            }
        }
    } finally {
        Set-OpenClawVersion -OpenClawVersion $openClawBuildConfig.defaultTrack.openclawVersion -TrackDisplayName $openClawBuildConfig.defaultTrack.displayName
        Pop-Location
    }

    exit 0
}

$selectedOpenClawTrack = $resolvedOpenClawTracks | Select-Object -First 1

$targetList = Normalize-TargetsForHost -ResolvedTargets (Resolve-Targets -RawTargets $Targets)

if ($targetList.Contains("tar.gz") -and $targetList.Count -gt 1) {
    Fail "tar.gz must be built as a dedicated generic Linux track. Please build it separately from deb/rpm/AppImage targets."
}

$needsFpm = $targetList.Contains("deb") -or $targetList.Contains("rpm")
$displayTargets = ($targetList | ForEach-Object { $_ }) -join ", "
$targetSuffix = (
    $targetList | ForEach-Object {
        switch ($_) {
            "AppImage" { "appimage" }
            "tar.gz" { "targz" }
            default { $_ }
        }
    }
) -join "-"

$rubyExe = $null
$rubyBin = $null
$msysBin = $null
$fpmWrapper = $null
if ($needsFpm) {
    $rubyExe = Resolve-Ruby
    if (-not $rubyExe) {
        Fail "Ruby not found. Please install RubyInstaller first."
    }

    $rubyBin = Split-Path -Parent $rubyExe
    $rubyRoot = Split-Path -Parent $rubyBin
    $msysBin = Join-Path $rubyRoot "msys64\usr\bin"
    if (-not (Test-Path (Join-Path $msysBin "tar.exe"))) {
        Fail "GNU tar for RubyInstaller was not found: $msysBin\tar.exe"
    }

    $fpmWrapper = Join-Path $RepoRoot "scripts\run-fpm-windows.rb"
    if (-not (Test-Path $fpmWrapper)) {
        Fail "Missing scripts\run-fpm-windows.rb"
    }
}

Push-Location $RepoRoot
try {
    Set-OpenClawVersion -OpenClawVersion $selectedOpenClawTrack.openclawVersion -TrackDisplayName $selectedOpenClawTrack.displayName

    if ($Version) {
        & node "set-version.cjs" $Version
        if ($LASTEXITCODE -ne 0) {
            Fail "Version update failed."
        }
    }

    $appVersion = (& node -p "require('./package.json').version").Trim()
    if (-not $appVersion) {
        Fail "Failed to read version from package.json"
    }

    $packageArch = if ($Arch -eq "x64") { "amd64" } else { "arm64" }
    $isGenericTrack = ($targetList.Count -eq 1 -and $targetList.Contains("tar.gz"))
    $updateTrack = if ($isGenericTrack) {
        "linux-generic-$packageArch"
    } else {
        "linux-debian-$packageArch"
    }
    $buildOutputDir = Resolve-BuildOutputDir -PreferredPath "release/.stage/linux-$packageArch-$($selectedOpenClawTrack.artifactSuffix)-$targetSuffix-$appVersion"

    Write-Host "========================================"
    Write-Host "ClawX - Linux $packageArch Build"
    Write-Host "========================================"
    Write-Host "OpenClaw Track: $($selectedOpenClawTrack.displayName) ($($selectedOpenClawTrack.openclawVersion))"
    Write-Host "Targets: $displayTargets"
    Write-Host

    Ensure-UvBinary -TargetArch $Arch

    if ($needsFpm) {
        Write-Host "[Step] Ensuring Windows-compatible FPM hook..."
        Ensure-FpmBridge
    }

    Write-Host "[Step] Building frontend/runtime assets..."
    $env:SKIP_PREINSTALLED_SKILLS = "1"
    & pnpm run package
    if ($LASTEXITCODE -ne 0) {
        Fail "Asset packaging failed."
    }

    Write-Host "[Step] Building Linux package(s): $displayTargets"
    & subst X: /d | Out-Null
    & subst X: $RepoRoot | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail "Failed to create temporary X: path mapping."
    }

    try {
        New-Item -ItemType Directory -Force -Path "C:\t" | Out-Null

        $env:TEMP = "C:\t"
        $env:TMP = "C:\t"
        if ($needsFpm) {
            $env:RUBY_FPM_RUBY = $rubyExe
            $env:CUSTOM_FPM_PATH = $fpmWrapper
            $env:PATH = "$rubyBin;$msysBin;$env:PATH"
        }

        Push-Location "X:\"
        try {
            $packageJsonPath = Join-Path $RepoRoot "package.json"
            $packageJsonBackup = Get-Content -Raw -Path $packageJsonPath
            $buildProfilePath = Join-Path $RepoRoot "build-profile.json"
            $buildProfileBackup = Get-Content -Raw -Path $buildProfilePath
            try {
                Write-BuildProfile `
                    -Variant "main" `
                    -DisplayName "Main Build $($selectedOpenClawTrack.displayName) (OpenClaw $($selectedOpenClawTrack.openclawVersion))" `
                    -IterativeCatBaseUrl "https://api.iterativecat.cn" `
                    -UpdateBaseUrl "https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main/$($selectedOpenClawTrack.updatePath)" `
                    -UpdateTrack $updateTrack `
                    -OpenClawTrack $selectedOpenClawTrack.id `
                    -OpenClawVersion $selectedOpenClawTrack.openclawVersion

                $packageJson = $packageJsonBackup | ConvertFrom-Json
                if ($packageJson.dependencies -and $packageJson.dependencies.PSObject.Properties.Name -contains "openclaw") {
                    Write-Host "[Step] Temporarily excluding root openclaw dependency from electron-builder scan..."
                    $packageJson.dependencies.PSObject.Properties.Remove("openclaw")
                    Write-Utf8NoBom -Path $packageJsonPath -Content (ConvertTo-PrettyJson -InputObject $packageJson)
                }
            } catch {
                Fail "Failed to prepare package.json for Linux build: $($_.Exception.Message)"
            }

            $builderArgs = @(
                "exec",
                "electron-builder",
                "--linux"
            )
            $builderArgs += $targetList
            $builderArgs += @(
                "--$Arch",
                "--publish",
                "never",
                "--config.directories.output=$buildOutputDir",
                "--config.extraMetadata.homepage=https://claw-x.com",
                "--config.productName=ClawX",
                "--config.artifactName=`${productName}-$($selectedOpenClawTrack.artifactSuffix)-`${os}-`${arch}.`${ext}"
            )

            & pnpm @builderArgs
            if ($LASTEXITCODE -ne 0) {
                Fail "Linux $packageArch build failed for target(s): $displayTargets"
            }

            if ($isGenericTrack) {
                $genericTrackBaseUrl = "https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main/$updateTrack"
                $tarball = Get-ChildItem -Path $buildOutputDir -Filter "*.tar.gz" -File | Select-Object -First 1
                if (-not $tarball) {
                    Fail "Generic Linux tar.gz artifact not found in $buildOutputDir"
                }

                $packageUrl = "$genericTrackBaseUrl/$($tarball.Name)"
                New-GenericLinuxMetadata -BuildOutputDir $buildOutputDir -PackageUrl $packageUrl -Version $appVersion
            }

            Copy-LinuxSupportScripts -BuildOutputDir $buildOutputDir
            Verify-LinuxUpdateMetadata -BuildOutputDir $buildOutputDir -IsGenericTrack:$isGenericTrack -TrackId $selectedOpenClawTrack.id -Arch $Arch
        } finally {
            if ($packageJsonPath -and $packageJsonBackup) {
                Write-Utf8NoBom -Path $packageJsonPath -Content $packageJsonBackup
            }
            if ($buildProfilePath -and $buildProfileBackup) {
                Write-Utf8NoBom -Path $buildProfilePath -Content $buildProfileBackup
            }
            Pop-Location
        }
    } finally {
        & subst X: /d | Out-Null
    }

    Write-Host
    Write-Host "[Done] Linux $packageArch package(s) are ready:"
    Write-Host "       $buildOutputDir"
    Write-Host
    if ($targetList.Contains("deb")) {
        Write-Host "[Note] Debian/Ubuntu package output includes the .deb artifact in the directory above."
    }
    if ($targetList.Contains("rpm")) {
        Write-Host "[Note] CentOS/RHEL package output includes the .rpm artifact in the directory above."
    }
    if ($targetList.Contains("tar.gz")) {
        Write-Host "[Note] The tar.gz artifact is the most portable option for headless servers."
        Write-Host "[Note] latest.json has been generated in the same output directory for generic Linux updates."
    }
} finally {
    Pop-Location
}
