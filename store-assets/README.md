# Browser store image packs

These upload-ready PNGs are rendered from the tracked DBOPFS Studio mark and
the extension's deterministic demonstration mode. The demonstration records
and `studio.demo.local` origin are fictional; the interface is the shipped
Studio UI.

Regenerate and validate the complete set from the repository root:

```sh
npm run store:assets
npm run store:assets:check
```

`asset-manifest.json` fingerprints every renderer input and output. Validation
rejects stale or unexpected PNGs, checks exact dimensions and color mode,
decodes every image in Chromium, and verifies the store-specific icon padding.

## Chrome Web Store

| Store field | Requirement | File |
| --- | --- | --- |
| Store icon | Required in the extension ZIP, 128×128 PNG with 96×96 artwork and 16px transparent padding | `chrome/icon/store-icon-128x128.png` (already identical to the ZIP's manifest icon) |
| Small promo tile | Required, 440×280 PNG or JPEG | `chrome/promo/small-promo-440x280.png` |
| Screenshots | Required, 1–5 at 1280×800 or 640×400 | All five files in `chrome/screenshots/` |
| Marquee promo tile | Optional, 1400×560 PNG or JPEG | `chrome/promo/marquee-promo-1400x560.png` |

The 128×128 store icon is identical to the padded manifest icon included in
the extension ZIP. Official requirements: [Chrome Web Store image
guidelines](https://developer.chrome.com/docs/webstore/images).

## Microsoft Edge Add-ons

| Store field | Requirement | File |
| --- | --- | --- |
| Extension logo | Required for each listing language, square; 300×300 recommended and 128×128 minimum | `edge/logo/extension-logo-300x300.png` |
| Small promotional tile | Optional in the detailed Partner Center guide; included defensively because Microsoft's overview calls it required, 440×280 | `edge/promo/small-promo-440x280.png` |
| Screenshots | Optional per-language assets, up to 6 at 1280×800 or 640×480 | All five files in `edge/screenshots/` |
| Large promotional tile | Optional per-language asset, 1400×560 PNG | `edge/promo/large-promo-1400x560.png` |

Partner Center can duplicate an English asset across other listing languages.
Official requirements: [Microsoft Edge Add-ons publishing
guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

## Opera Add-ons

| Store field | Requirement | File |
| --- | --- | --- |
| Listing icon | Required by the current live form, 64×64 | `opera/icons/icon-64x64.png` |
| Promotional Image | Optional; exactly 300×188 for potential Recommended featuring | `opera/promo/promotional-image-300x188.png` |
| Screenshots | Required; 612×408 preferred, 800×600 maximum | Both files in `opera/screenshots/` |

The publisher-approved Opera 64px icon is preserved byte-for-byte from
`assets/opera-store-icon-64x64.png`; it uses 56px artwork with 4px transparent
padding on every side. The live developer dashboard's Promotional Image field
accepts one optional 300×188 image and recommends including the extension name,
logo, and a short purpose phrase. The field is used only if Opera chooses the
extension for Recommended featuring. See Opera's official [Promotional Image
field template](https://addons-static.operacdn.com/static/developer/app/components/package/views/promotion.html).

Opera recommends one screenshot showing how the extension works and another
showing how it looks. These non-interlaced PNGs use Opera's preferred white
surround. The public guide provides the screenshot guidance, while the live
form template supplies the current Promotional Image dimensions. Official
requirements: [Opera publishing
guidelines](https://help.opera.com/en/extensions/publishing-guidelines/),
[acceptance criteria](https://help.opera.com/en/extensions/acceptance-criteria/).

The public guidance also recommends showing the extension in Opera's default
browser UI. Opera is not installed in this rendering workspace, so capture one
additional clean Opera toolbar or DevTools context during the required Opera
compatibility test if the live submission form or reviewer requests it.

## Brave and Vivaldi

Brave and Vivaldi's current official extension guidance directs users to the
Chrome Web Store and provides no separate general developer-submission path,
so the Chrome pack covers their distribution. The exact release should still
be tested in both browsers before compatibility is claimed. See [Brave's extension
guidance](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave)
and [Vivaldi's extension
guidance](https://help.vivaldi.com/desktop/appearance-customization/extensions/).

## Release discipline

Re-render the assets whenever visible Studio behavior or branding changes.
Before submission, compare the screenshots with the exact release ZIP, test
that ZIP in each advertised browser, and review each store's live form in case
its requirements changed after this pack was prepared.
