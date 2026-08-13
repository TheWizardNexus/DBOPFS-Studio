# Security policy

## Supported version

Security fixes are provided for the current release line. Before the first
stable release, use the latest commit on `main` when validating a report.

## Reporting a vulnerability

Do not publish exploit details, user data, credentials, tokens, or sensitive
storage contents in a public issue. Use GitHub's private vulnerability-reporting
feature for this repository. If that feature is unavailable, open a minimal
issue asking the maintainers for a private reporting channel.

Include the affected DBOPFS Studio version or commit, browser name and version,
operating system, reproduction steps, and impact. Remove real site data from
screenshots, exports, and diagnostic files.

## Security boundaries

OPFS is scoped to an origin by the browser. A DBOPFS application ID creates an
organizational folder inside that origin; it is not a hostile-code security
boundary. Scripts running with authority on the same origin may use the raw
browser storage APIs without DBOPFS.

DBOPFS Studio requires an active page or inspected-page context and browser
permission before it can work with that origin. Treat exported files and print
jobs as copies outside OPFS: their confidentiality then depends on the download
location, operating system, printer, and any synchronization software involved.

Use separate domains or subdomains, browser profiles, and appropriate device
controls when applications or users require stronger isolation. Review the
[architecture guide](https://thewizardnexus.github.io/DBOPFS-Studio/architecture.html)
for the complete trust model.
