# Browser store listing draft

This copy is prepared for the Chrome Web Store and Microsoft Edge Add-ons. It
must be reviewed against the final packaged version before either listing is
submitted.

## Product name

DBOPFS Studio

## Short description

A DBOPFS-powered OPFS workspace for Chrome, Edge, Brave, Vivaldi, Opera, and other Chromium browsers.

## Detailed description

DBOPFS Studio makes browser-native application data understandable. Connect it
to the current site or inspected DevTools tab to see that origin's DBOPFS
applications, tables, records, storage usage, quota, and persistence state in a
focused desktop workspace.

Use the bundled DBOPFS module to create applications, tables, and records;
import files; edit text and JSON inline; validate JSON before saving; export an
application; and delete a record with exact-name confirmation. Preview images,
audio, and video with browser-native controls. Open PDF records in the
Chromium browser's own PDF surface for the viewing, annotation, saving, and
printing tools available in that browser build. Text, JSON, Markdown, and
images also have a dedicated printable Studio view.

DBOPFS Studio is local by design. It has no account, analytics service, or
cloud synchronization feature, and it does not send inspected OPFS content to
The Wizard Nexus. OPFS remains isolated by site origin, so Studio works with
one selected live HTTP(S) page at a time rather than pretending every closed
site is a mounted global drive.

Commercial licenses are one-time purchases for the licensed version. There is
no monthly subscription or mandatory recurring DBOPFS Studio license fee after
purchase. Optional support, future major-version upgrades, and third-party
services may have separate costs.

Chrome and Microsoft Edge are first-class targets. Brave, Vivaldi, Opera, and
other current Chromium browsers are compatibility targets when their extension
policy and OPFS APIs provide the required capabilities.

## Permission rationale

- `storage`: holds a selected record only long enough to hand it to Studio's
  extension-owned printable page; that page removes the session entry as soon
  as it reads it.
- Access to HTTP(S) sites: places a dormant isolated bridge on ordinary web
  pages so an explicitly opened Studio or DevTools panel can perform DBOPFS
  operations in the selected site's origin. The bridge does not read OPFS until
  Studio sends it a request. This host access also lets extension pages identify
  the selected HTTP(S) tab and show its origin without requesting the separate
  `tabs` API permission.

The extension requests no tabs or downloads permission, remote code, analytics,
or account access. Browser-internal and other protected pages remain
unavailable.

## Public URLs

- Product and support: <https://thewizardnexus.github.io/DBOPFS-Studio/>
- Privacy policy: <https://thewizardnexus.github.io/DBOPFS-Studio/privacy.html>
- Source: <https://github.com/TheWizardNexus/DBOPFS-Studio>
- Security policy: <https://github.com/TheWizardNexus/DBOPFS-Studio/blob/main/SECURITY.md>

## Listing images

Upload-ready Chrome Web Store, Microsoft Edge Add-ons, and Opera Add-ons image
sets are tracked in [`store-assets/`](store-assets/README.md). The renderer uses
the shipped Studio interface with fictional demonstration records and produces
all required pixel dimensions plus the optional Chrome/Edge feature tile.

Brave and Vivaldi do not require separate listing artwork because both install
extensions from the Chrome Web Store. They remain compatibility-test targets.

## Pre-submission gate

- Regenerate and validate the listing images with `npm run store:assets`.
- Run `npm run release:test` after the visible interface and artwork are final.
- Test the exact ZIP on the owner's machine in Chrome with **Load unpacked**.
- Repeat the core open/edit/save/PDF/print path in Microsoft Edge.
- Confirm the package SHA-256 matches the release-test output.
- Review the store data-safety answers against `PRIVACY.md` and the manifest.
- Compare the listing images with that exact build.
- Submit only after the repository owner explicitly approves publication.
