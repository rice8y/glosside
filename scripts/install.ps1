param(
    [string]$Version = 'latest',
    [string]$InstallDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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
$repository = 'https://github.com/rice8y/glosside'
# Windows PowerShell 5.1 may otherwise negotiate older TLS versions.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Version -eq 'latest') {
    $Version = (Invoke-RestMethod -Uri 'https://api.github.com/repos/rice8y/glosside/releases/latest' -Headers @{ 'User-Agent' = 'Glosside-installer' }).tag_name
}
if ($Version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$') { throw 'Version must be a release tag such as v0.1.0.' }
if (Test-Path -LiteralPath $InstallDir) {
    $target = Get-Item -LiteralPath $InstallDir -Force
    if (-not $target.PSIsContainer -or ($target.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The installation path must be a directory, not a link.' }
    $marker = Join-Path $InstallDir '.glosside-install'
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne 'glosside-v1') {
        throw "Refusing to replace an unmanaged directory: $InstallDir"
    }
}
$parent = Split-Path -Parent $InstallDir
[IO.Directory]::CreateDirectory($parent) | Out-Null
$lock = "$InstallDir.install-lock"
New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null
$stage = Join-Path $parent ('.glosside-install.' + [Guid]::NewGuid().ToString('N'))
$backup = Join-Path $stage 'previous'
$keepBackup = $false
try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    $archive = Join-Path $stage 'archive.zip'
    $checksum = Join-Path $stage 'checksum'
    $base = "$repository/releases/download/$Version"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/glosside-chrome.zip" -OutFile $archive -TimeoutSec 300
    Invoke-WebRequest -UseBasicParsing -Uri "$base/glosside-chrome.zip.sha256" -OutFile $checksum -TimeoutSec 60
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
    if (Test-Path -LiteralPath $InstallDir) { Move-Item -LiteralPath $InstallDir -Destination $backup }
    Move-Item -LiteralPath $extension -Destination $InstallDir
    Write-Host "`nGlosside $Version installed in:`n$InstallDir`n"
    Write-Host 'Open chrome://extensions, enable Developer mode, and select this directory with Load unpacked.'
    Write-Host 'For an update, click Reload on Glosside and reload your open pages.'
} finally {
    if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $InstallDir)) {
        try { Move-Item -LiteralPath $backup -Destination $InstallDir } catch { $keepBackup = $true; Write-Warning "Restore the previous installation from $backup" }
    }
    if (-not $keepBackup -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
    Remove-Item -LiteralPath $lock -Force
}
