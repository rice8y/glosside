param(
    [string]$Version = 'latest',
    [string]$InstallDir,
    [string]$AssetsDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($PSBoundParameters.ContainsKey('AssetsDir')) {
    if (-not $AssetsDir -or $Version -eq 'latest' -or -not $InstallDir) {
        throw 'Local assets require -AssetsDir, -Version and -InstallDir.'
    }
    $localZip = Join-Path $AssetsDir 'glosside-chrome.zip'
    $localChecksum = "$localZip.sha256"
    if (-not (Test-Path -LiteralPath $localZip -PathType Leaf) -or
        -not (Test-Path -LiteralPath $localChecksum -PathType Leaf)) {
        throw 'Local ZIP or checksum missing. Run npm run package first.'
    }
}
if (-not $InstallDir) {
    if ($env:OS -eq 'Windows_NT') {
        if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set.' }
        $InstallDir = Join-Path $env:LOCALAPPDATA 'Glosside/extension'
    } elseif ((uname -s) -eq 'Darwin') {
        $InstallDir = Join-Path $env:HOME 'Library/Application Support/Glosside/extension'
    } elseif ((uname -s) -eq 'Linux') {
        $dataDirectory = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $env:HOME '.local/share' }
        $InstallDir = Join-Path $dataDirectory 'glosside/extension'
    } else { throw 'Unsupported platform. Specify -InstallDir.' }
}
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
if ($InstallDir.TrimEnd([IO.Path]::DirectorySeparatorChar) -eq [IO.Path]::GetPathRoot($InstallDir).TrimEnd([IO.Path]::DirectorySeparatorChar)) {
    throw 'Choose a dedicated extension directory.'
}
$InstallDir = $InstallDir.TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
if (-not $AssetsDir) {
    $repository = 'https://github.com/rice8y/glosside'
    # Windows PowerShell 5.1 may otherwise negotiate older TLS versions.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if ($Version -eq 'latest') {
        $Version = (Invoke-RestMethod -Uri 'https://api.github.com/repos/rice8y/glosside/releases/latest' -Headers @{ 'User-Agent' = 'Glosside-installer' }).tag_name
    }
}
if ($Version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$') { throw 'Version must be a release tag such as v0.1.0.' }
$parent = Split-Path -Parent $InstallDir
[IO.Directory]::CreateDirectory($parent) | Out-Null
$lock = "$InstallDir.install-lock"
New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null
$stage = Join-Path $parent ('.glosside-install.' + [Guid]::NewGuid().ToString('N'))
$backup = Join-Path $stage 'previous'
$keepBackup = $false
try {
    $isUpdate = Test-Path -LiteralPath $InstallDir
    if ($isUpdate) {
        $target = Get-Item -LiteralPath $InstallDir -Force
        if (-not $target.PSIsContainer -or ($target.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The installation path must be a directory, not a link.' }
        $marker = Join-Path $InstallDir '.glosside-install'
        if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne 'glosside-v1') {
            throw "Refusing to replace an unmanaged directory: $InstallDir"
        }
    }
    New-Item -ItemType Directory -Path $stage | Out-Null
    $archive = Join-Path $stage 'archive.zip'
    $checksum = Join-Path $stage 'checksum'
    if ($AssetsDir) {
        Copy-Item -LiteralPath $localZip -Destination $archive
        Copy-Item -LiteralPath $localChecksum -Destination $checksum
    } else {
        $base = "$repository/releases/download/$Version"
        Invoke-WebRequest -UseBasicParsing -Uri "$base/glosside-chrome.zip" -OutFile $archive -TimeoutSec 300
        Invoke-WebRequest -UseBasicParsing -Uri "$base/glosside-chrome.zip.sha256" -OutFile $checksum -TimeoutSec 60
    }
    $check = (Get-Content -LiteralPath $checksum -Raw).Trim()
    if ($check -notmatch '^([a-f0-9]{64})  glosside-chrome\.zip$') { throw 'Invalid checksum file.' }
    $expected = $Matches[1]
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Archive checksum does not match.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -notmatch '^glosside/[a-zA-Z0-9_./-]+$' -or $entry.FullName -match '(^|/)\.\.(/|$)' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) {
                throw 'Unsafe archive entry.'
            }
        }
    } finally { $zip.Dispose() }
    $unpacked = Join-Path $stage 'unpacked'
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
    $extension = Join-Path $unpacked 'glosside'
    $manifest = Get-Content -LiteralPath (Join-Path $extension 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.name -ne 'Glosside' -or $manifest.manifest_version -ne 3 -or $manifest.version -ne $Version.Substring(1)) { throw 'Unexpected extension or version.' }
    [IO.File]::WriteAllText((Join-Path $extension '.glosside-install'), "glosside-v1`n")
    if ($isUpdate) { Move-Item -LiteralPath $InstallDir -Destination $backup }
    Move-Item -LiteralPath $extension -Destination $InstallDir
} finally {
    if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $InstallDir)) {
        try { Move-Item -LiteralPath $backup -Destination $InstallDir } catch { $keepBackup = $true; Write-Warning "Restore the previous installation from $backup" }
    }
    if (-not $keepBackup -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
    Remove-Item -LiteralPath $lock -Force
}

if ($isUpdate) {
    Write-Host "`nGlosside $Version updated."
    Write-Host 'Open chrome://extensions in Chrome, click Reload on Glosside, then refresh your open pages.'
    return
}

Write-Host "`nGlosside $Version installed in:`n$InstallDir`n"
Write-Host 'Open chrome://extensions, enable Developer mode, and select this directory with Load unpacked.'
$instructions = Join-Path $InstallDir 'install.html'
if (-not (Test-Path -LiteralPath $instructions -PathType Leaf)) { return }
Write-Host "`nInstallation instructions: $instructions"
if ([Console]::IsInputRedirected) { return }

try {
    $choice = Read-Host 'Open in Google Chrome [o], copy URL [c], or skip [Enter]'
} catch {
    return
}

function Get-InstructionsUrl {
    $path = if ($env:OS -eq 'Windows_NT') { $instructions.Replace('\', '/') } else { $instructions }
    $escapedPath = [regex]::Replace($path, '[^/:]+', {
        param($segment)
        [uri]::EscapeDataString($segment.Value)
    })
    if ($escapedPath.StartsWith('//')) { return "file:$escapedPath" }
    if ($escapedPath.StartsWith('/')) { return "file://$escapedPath" }
    return "file:///$escapedPath"
}

switch ($choice) {
    'o' {
        try {
            if ($env:OS -eq 'Windows_NT') {
                Start-Process -FilePath 'chrome.exe' -ArgumentList (Get-InstructionsUrl)
            } elseif ((uname -s) -eq 'Darwin') {
                & open -a 'Google Chrome' $instructions
                if ($LASTEXITCODE -ne 0) { throw 'Chrome launch failed.' }
            } else {
                $chrome = Get-Command google-chrome, google-chrome-stable -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
                if (-not $chrome -or (-not $env:DISPLAY -and -not $env:WAYLAND_DISPLAY)) {
                    throw 'Chrome unavailable.'
                }
                Start-Process -FilePath $chrome.Source -ArgumentList (Get-InstructionsUrl)
            }
        } catch {
            Write-Warning 'Could not open Google Chrome. Open the installation instructions at the path above.'
        }
    }
    'c' {
        $url = Get-InstructionsUrl
        try {
            if ($env:OS -ne 'Windows_NT' -and $env:WAYLAND_DISPLAY -and
                (Get-Command wl-copy -CommandType Application -ErrorAction SilentlyContinue)) {
                wl-copy -- $url
                if ($LASTEXITCODE -ne 0) { throw 'Clipboard unavailable.' }
            } else {
                Set-Clipboard -Value $url
            }
            Write-Host "URL copied. Paste it into your browser's address bar."
        } catch {
            Write-Host "Copy this URL into your browser: $url"
        }
    }
}
