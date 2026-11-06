#!/bin/sh
set -eu

fail() { printf 'Glosside: %s\n' "$*" >&2; exit 1; }
version=latest
install_dir=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--dir)
      [ "$#" -ge 2 ] || fail "Missing value for $1"
      case "$1" in --version) version=$2 ;; --dir) install_dir=$2 ;; esac
      shift 2 ;;
    --help|-h)
      printf 'Usage: sh install.sh [--version v0.1.0] [--dir /absolute/path]\n'
      exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
if [ -z "$install_dir" ]; then
  case "$(uname -s)" in
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
for cmd in curl unzip awk mktemp; do command -v "$cmd" >/dev/null 2>&1 || fail "$cmd is required."; done
if command -v sha256sum >/dev/null 2>&1; then hash_command=sha256sum
elif command -v shasum >/dev/null 2>&1; then hash_command=shasum
else fail 'sha256sum or shasum is required.'; fi
repository=https://github.com/rice8y/glosside
fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300 "$@"; }
if [ "$version" = latest ]; then
  resolved=$(fetch --output /dev/null --write-out '%{url_effective}' "$repository/releases/latest") || fail 'Could not find the latest release.'
  case "$resolved" in "$repository"/releases/tag/*) version=${resolved##*/} ;; *) fail 'Unexpected release URL.' ;; esac
fi
printf '%s\n' "$version" | awk '/^v[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$/ {valid=1} END {exit !valid}' || fail 'Version must be a release tag such as v0.1.0.'
parent=$(dirname "$install_dir")
mkdir -p "$parent"
parent=$(cd "$parent" && pwd -P)
install_dir="$parent/${install_dir##*/}"
[ ! -L "$install_dir" ] || fail 'The installation directory must not be a symlink.'
if [ -e "$install_dir" ]; then
  [ -d "$install_dir" ] && [ -f "$install_dir/.glosside-install" ] && [ "$(cat "$install_dir/.glosside-install")" = glosside-v1 ] || fail "Refusing to replace an unmanaged directory: $install_dir"
fi
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
stage=$(mktemp -d "$parent/.glosside-install.XXXXXX")
base="$repository/releases/download/$version"
fetch --output "$stage/archive.zip" "$base/glosside-chrome.zip"
fetch --output "$stage/checksum" "$base/glosside-chrome.zip.sha256"
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
if [ -e "$install_dir" ]; then mv "$install_dir" "$stage/previous"; fi
mv "$stage/unpacked/glosside" "$install_dir"
printf '\nGlosside %s installed in:\n%s\n\n' "$version" "$install_dir"
printf 'Open chrome://extensions, enable Developer mode, and select this directory with Load unpacked.\nFor an update, click Reload on Glosside and reload your open pages.\n'
