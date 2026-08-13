# Privacy policy

**Effective date: August 13, 2026**

DBOPFS Studio is designed to inspect and manage Origin Private File System
(OPFS) data locally in the user's Chromium browser.

## Data DBOPFS Studio accesses

The extension is permitted to run an isolated bridge on HTTP(S) pages. When the
user connects DBOPFS Studio to an active tab or inspected page, the extension
may access:

- the connected site's origin;
- OPFS directory names, file names, file metadata, and file contents;
- DBOPFS application IDs, table names, record keys, and record values;
- browser-reported storage usage, quota, and persistence state.

The dormant isolated bridge makes the extension available to a selected page.
On first request it imports the packaged agent in the same isolated
content-script world and calls that agent directly; it does not inject a script
into the page's main world or pass record data through DOM events. Database and
filesystem reads begin in response to Studio requests. This access is used to
provide the requested DBOPFS dashboard, explorer, editor, previews, import,
application export, supported record printing, and record-management functions.

## Collection and transmission

The extension is designed not to send inspected OPFS content, file names,
record values, or browsing history to The Wizard Nexus or to an analytics,
advertising, or profiling service. It does not require a DBOPFS Studio account.
Processing occurs in the browser unless the user deliberately exports,
downloads, prints, or copies data to another destination.

The browser, browser extension store, GitHub, operating system, selected printer,
or a link the user opens may process information under its own terms. Those
services are outside DBOPFS Studio's control.

## Storage and retention

Site data remains in that site's browser-managed OPFS until the site, user,
browser, or operating system changes or removes it. For supported record
printing, Studio places one temporary payload in extension session storage;
the print page removes it as soon as it reads it, and the browser also discards
session storage when the extension is reloaded or restarted. The extension does
not create a remote backup or synchronization service.

Exports and downloads remain wherever the user saves them. Print output and
spool data are controlled by the browser, operating system, and printer.

## User control

Users can close Studio or the selected site tab, revoke HTTP(S) site access in
the browser, remove exported files, clear site data, or uninstall the
extension.
Deleting OPFS data is destructive and may break the site that owns it; DBOPFS
Studio presents guarded actions but cannot reconstruct data without a backup.

## Origin isolation

OPFS is separated by origin and, in some browser configurations, by additional
storage partitioning. DBOPFS Studio does not merge unrelated origins into a
single live filesystem. It needs a live active or inspected page and the
browser-granted access required for that origin.

## Changes and contact

Material changes will be published in this repository and reflected by an
updated effective date. For privacy questions, use the contact path published
by [The Wizard Nexus](https://www.thewizardnexus.com/). Do not include private
site data or credentials in a public issue.
