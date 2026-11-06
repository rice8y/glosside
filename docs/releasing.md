# Publishing a release

1. Update `version` in `package.json`, `package-lock.json`, and `src/manifest.json` to the same numeric version, such as `0.1.0`.
2. Review `docs/release-notes.md` and run `npm run package`. This type-checks the source, builds without source maps, checks the build inventory, and creates the assets under the ignored `release/` directory. It requires no local `dev/` files.
3. Run the local regression checks described in `dev/README.md` when that development directory is available. Check the resulting extension in Chrome before publishing.
4. Commit and push the changes, then push the matching version tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

The release workflow verifies that the tag, package, and extension versions match, then publishes these assets to GitHub Releases:

- `glosside-chrome.zip`: the extension inside a `glosside/` directory; no model weights or source maps.
- `glosside-chrome.zip.sha256`: the archive's SHA-256 checksum.
- `install.sh`: installer for macOS, Linux, and Windows shells with `cygpath`.
- `install.ps1`: PowerShell installer, including Windows PowerShell 5.1.

The installer resolves the latest release to a specific tag before downloading the archive and checksum. An existing installation is replaced only if it has the installer's ownership marker. A failed download, checksum, or extraction leaves the installed version intact. The extension directory stays at the same path across updates; users reload the unpacked extension in Chrome afterward.

To reproduce a particular release locally, use `RELEASE_TAG=v0.1.0 npm run package` at that tag. Re-running the workflow for an already published tag does not overwrite its assets; publish a new version instead.

For a specific version or destination, `install.sh` accepts `--version v0.1.0 --dir /absolute/path`; `install.ps1` accepts `-Version v0.1.0 -InstallDir C:\path\to\Glosside`. With the shell one-liner, pass options after `sh -s --`.
