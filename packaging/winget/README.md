# winget packaging

Manifests for publishing purerequest to the Windows Package Manager
([microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)).

Package identifier: `Pzielinski.PureRequest`

## One-time first submission (manual)

The [`publish-winget.yml`](../../.github/workflows/publish-winget.yml) workflow can only *update* a
package that already exists in winget-pkgs; it cannot create a brand-new one. So the very first
version has to be submitted by hand:

1. Fork `microsoft/winget-pkgs` under `piotrzielinski1994`.
2. Copy the three manifests in this folder into the fork at
   `manifests/p/Pzielinski/PureRequest/0.1.0/` (keep the filenames as-is; the path is
   case-sensitive and mirrors the identifier segments).
3. Validate + smoke-test locally on a Windows box:
   ```powershell
   winget validate --manifest manifests\p\Pzielinski\PureRequest\0.1.0
   winget install --manifest manifests\p\Pzielinski\PureRequest\0.1.0
   ```
4. Open a PR from the fork to `microsoft/winget-pkgs` `master`. The Microsoft validation bot runs
   automatically; a human moderator reviews.

## Every later release (automatic)

Once `0.1.0` is merged, `publish-winget.yml` fires on each published GitHub Release and opens the
update PR for you via [winget-releaser](https://github.com/vedantmgoyal9/winget-releaser). It picks
the `_x64-setup.exe` (NSIS) asset, computes its sha256, and files the manifest bump.

### Required secret

Add repo secret `WINGET_TOKEN`: a **classic** PAT (fine-grained PATs are not supported by the
action) with `public_repo` scope, owned by the account that holds the winget-pkgs fork.
