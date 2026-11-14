#!/bin/sh
set -eu

fail() { printf 'Glosside: %s\n' "$*" >&2; exit 1; }
version=latest
install_dir=
assets_dir=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--dir|--assets-dir)
      [ "$#" -ge 2 ] || fail "Missing value for $1"
      case "$1" in
        --version) version=$2 ;;
        --dir) install_dir=$2 ;;
        --assets-dir) [ -n "$2" ] || fail 'Missing value for --assets-dir'; assets_dir=$2 ;;
      esac
      shift 2 ;;
    --help|-h)
      printf 'Usage: sh install.sh [--version v0.1.0] [--dir /absolute/path]\n'
      printf '       sh install.sh --assets-dir path --version v0.1.0 --dir /absolute/path\n'
      exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
if [ -n "$assets_dir" ]; then
  [ "$version" != latest ] && [ -n "$install_dir" ] || fail 'Local assets require --version and --dir.'
fi
platform=$(uname -s)
if [ -z "$install_dir" ]; then
  case "$platform" in
    Darwin) install_dir="${HOME:?HOME is required}/Library/Application Support/Glosside/extension" ;;
    Linux) install_dir="${XDG_DATA_HOME:-${HOME:?HOME is required}/.local/share}/glosside/extension" ;;
    MINGW*|MSYS*|CYGWIN*)
      command -v cygpath >/dev/null 2>&1 || fail 'Use install.ps1 in Windows PowerShell.'
      install_dir="$(cygpath -u "${LOCALAPPDATA:?LOCALAPPDATA is required}")/Glosside/extension" ;;
    *) fail 'Unsupported platform. Use --dir to choose an installation directory.' ;;
  esac
fi
case "$install_dir" in /*) ;; *) fail '--dir must be an absolute path.' ;; esac
install_dir=${install_dir%/}
case "${install_dir##*/}" in ''|.|..) fail 'Choose a dedicated extension directory.' ;; esac
for cmd in unzip awk mktemp; do command -v "$cmd" >/dev/null 2>&1 || fail "$cmd is required."; done
if command -v sha256sum >/dev/null 2>&1; then hash_command=sha256sum
elif command -v shasum >/dev/null 2>&1; then hash_command=shasum
else fail 'sha256sum or shasum is required.'; fi
repository=https://github.com/rice8y/glosside
fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300 "$@"; }
if [ -n "$assets_dir" ]; then
  case "$assets_dir" in /*) ;; *) assets_dir="./$assets_dir" ;; esac
  [ -f "$assets_dir/glosside-chrome.zip" ] && [ -f "$assets_dir/glosside-chrome.zip.sha256" ] ||
    fail 'Local ZIP or checksum missing. Run npm run package first.'
else
  command -v curl >/dev/null 2>&1 || fail 'curl is required.'
  if [ "$version" = latest ]; then
    resolved=$(fetch --output /dev/null --write-out '%{url_effective}' "$repository/releases/latest") || fail 'Could not find the latest release.'
    case "$resolved" in "$repository"/releases/tag/*) version=${resolved##*/} ;; *) fail 'Unexpected release URL.' ;; esac
  fi
fi
printf '%s\n' "$version" | awk '/^v[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$/ {valid=1} END {exit !valid}' || fail 'Version must be a release tag such as v0.1.0.'
parent=$(dirname "$install_dir")
mkdir -p "$parent"
parent=$(cd "$parent" && pwd -P)
install_dir="$parent/${install_dir##*/}"
lock="$install_dir.install-lock"
mkdir "$lock" 2>/dev/null || fail 'Another installation is running (or an old install lock needs removal).'
stage=
cleanup() {
  if [ -n "$stage" ] && [ -d "$stage" ]; then
    if [ -d "$stage/previous" ] && [ ! -e "$install_dir" ]; then
      mv "$stage/previous" "$install_dir" || { printf 'Restore the previous installation from %s\n' "$stage/previous" >&2; rmdir "$lock"; return; }
    fi
    rm -rf "$stage"
  fi
  rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
is_update=false
[ ! -L "$install_dir" ] || fail 'The installation directory must not be a symlink.'
if [ -e "$install_dir" ]; then
  [ -d "$install_dir" ] && [ -f "$install_dir/.glosside-install" ] && [ "$(cat "$install_dir/.glosside-install")" = glosside-v1 ] || fail "Refusing to replace an unmanaged directory: $install_dir"
  is_update=true
fi
stage=$(mktemp -d "$parent/.glosside-install.XXXXXX")
if [ -n "$assets_dir" ]; then
  cp "$assets_dir/glosside-chrome.zip" "$stage/archive.zip"
  cp "$assets_dir/glosside-chrome.zip.sha256" "$stage/checksum"
else
  base="$repository/releases/download/$version"
  fetch --output "$stage/archive.zip" "$base/glosside-chrome.zip"
  fetch --output "$stage/checksum" "$base/glosside-chrome.zip.sha256"
fi
expected=$(awk 'NF == 2 && $2 == "glosside-chrome.zip" {print $1}' "$stage/checksum")
[ "${#expected}" -eq 64 ] || fail 'Invalid checksum file.'
case "$expected" in *[!0-9a-f]*) fail 'Invalid checksum file.' ;; esac
if [ "$hash_command" = sha256sum ]; then actual=$(sha256sum "$stage/archive.zip"); else actual=$(shasum -a 256 "$stage/archive.zip"); fi
[ "${actual%% *}" = "$expected" ] || fail 'Archive checksum does not match.'
unzip -Z1 "$stage/archive.zip" > "$stage/entries"
awk '!/^glosside\/[a-zA-Z0-9_.\/-]+$/ || /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}' "$stage/entries" || fail 'Unsafe archive paths.'
unzip -Z -l "$stage/archive.zip" | awk '/^l/ {bad=1} END {exit bad}' || fail 'Archive contains symlinks.'
unzip -q "$stage/archive.zip" -d "$stage/unpacked"
[ -f "$stage/unpacked/glosside/manifest.json" ] || fail 'The archive does not contain an extension.'
installed_version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^" ]*\)".*/\1/p' "$stage/unpacked/glosside/manifest.json")
[ "$installed_version" = "${version#v}" ] || fail 'Unexpected extension version.'
printf 'glosside-v1\n' > "$stage/unpacked/glosside/.glosside-install"
if "$is_update"; then mv "$install_dir" "$stage/previous"; fi
mv "$stage/unpacked/glosside" "$install_dir"
cleanup
trap - EXIT

if "$is_update"; then
  printf '\nGlosside %s updated.\nOpen chrome://extensions in Chrome, click Reload on Glosside, then refresh your open pages.\n' "$version"
  exit 0
fi

printf '\nGlosside %s installed in:\n%s\n\n' "$version" "$install_dir"
printf 'Open chrome://extensions, enable Developer mode, and select this directory with Load unpacked.\n'

instructions="$install_dir/install.html"
[ -f "$instructions" ] || exit 0
printf '\nInstallation instructions: %s\n' "$instructions"

prompt='Open in Google Chrome [o], copy URL [c], or skip [Enter]: '
if [ -t 0 ]; then
  printf '%s' "$prompt"
  IFS= read -r choice || exit 0
else
  # curl | sh uses stdin for the script, so read from the terminal directly.
  choice=$(
    exec 2>/dev/null
    exec 3<> /dev/tty
    [ -t 3 ] || exit 1
    printf '%s' "$prompt" >&3
    IFS= read -r choice <&3 && printf '%s' "$choice"
  ) || exit 0
fi

open_instructions() {
  case "$platform" in
    Darwin) open -a 'Google Chrome' "$instructions" ;;
    Linux)
      [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || return 1
      chrome=$(command -v google-chrome || command -v google-chrome-stable) || return 1
      "$chrome" "$instructions" </dev/null >/dev/null 2>&1 & ;;
    MINGW*|MSYS*|CYGWIN*)
      url=$(instructions_url) || return 1
      GLOSSIDE_INSTRUCTIONS_URL="$url" powershell.exe -NoProfile -NonInteractive -Command \
        'Start-Process -FilePath "chrome.exe" -ArgumentList $env:GLOSSIDE_INSTRUCTIONS_URL -ErrorAction Stop' ;;
    *) return 1 ;;
  esac
}

instructions_url() {
  path=$instructions
  case "$platform" in
    MINGW*|MSYS*|CYGWIN*)
      path=$(cygpath -m "$path") || return 1
      case "$path" in //*) ;; *) path="/$path" ;; esac ;;
  esac
  # Escape the path byte by byte so spaces, Unicode, and URL punctuation survive pasting.
  printf '%s' "$path" | LC_ALL=C od -An -v -tu1 | LC_ALL=C awk '
    BEGIN { printf "file://" }
    { for (i = 1; i <= NF; i++) {
        byte = sprintf("%c", $i)
        if (byte ~ /^[A-Za-z0-9._~\/:-]$/) printf "%s", byte
        else printf "%%%02X", $i
    } }
  '
}

copy_to_clipboard() {
  case "$platform" in
    Darwin) pbcopy ;;
    Linux)
      if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-copy >/dev/null 2>&1; then
        wl-copy
      elif [ -n "${DISPLAY:-}" ] && command -v xclip >/dev/null 2>&1; then
        xclip -selection clipboard
      else
        return 1
      fi ;;
    MINGW*|MSYS*|CYGWIN*) clip.exe ;;
    *) return 1 ;;
  esac
}

case "$choice" in
  o|O)
    open_instructions >/dev/null 2>&1 ||
      printf 'Could not open Google Chrome. Open the installation instructions at the path above.\n' ;;
  c|C)
    url=$(instructions_url) || exit 0
    if printf '%s' "$url" | copy_to_clipboard >/dev/null 2>&1; then
      printf "URL copied. Paste it into your browser's address bar.\n"
    else
      printf 'Copy this URL into your browser: %s\n' "$url"
    fi ;;
esac
