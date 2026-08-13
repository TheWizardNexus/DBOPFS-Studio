# Source provenance

DBOPFS Studio bundles the production DBOPFS 1.0.0 runtime published by The
Wizard Nexus so the extension's database-aware operations use DBOPFS as their
primary data layer.

The upstream source is:

- Repository: <https://github.com/TheWizardNexus/DBOPFS>
- Release: `v1.0.0`
- Source commit: `1b16a661ea8b60cc54b840ccda2e8a63d8a71046`

Byte-for-byte upstream copies are retained below
`extension/vendor/dbopfs/arcane/modules/`:

| Upstream runtime file | Git blob | SHA-256 |
| --- | --- | --- |
| `DBOPFS.js` | `f313b8c2ba18cf9e7a619f627dce215807b33387` | `133EA76AE80210B6F2E873D4240CACA62E1F8D43558F77FC0E471E60355EE5E8` |
| `DBOPFSWorker.js` | `5250c0854ce894f1e67d9b78342df68646085c2d` | `7B3F1B5176431A104A0FAA80063577362CC57EEF0800212ABAFC209F7912D14E` |
| `AppDataScope.js` | `9943961bd8c4cf93655eece17f14b29ea817357a` | `4AC7BE2FC8C7E0E3DFAE4D748ED6DFD7A9169464B3FFB91E12C65D6D69574A06` |

The isolated agent imports `DBOPFSStudio.js`, a clearly marked derivative of that
exact `DBOPFS.js`. The adaptation makes module import side-effect free, permits
an explicitly selected application namespace without replacing the inspected
page's own DBOPFS singleton, and allows discovery without creating default
tables or requesting persistent storage. The original module remains alongside
it for audit comparison. The adapted file's current SHA-256 is
`B8FE8042CC6FA818B03B12D5EF0313B05E61012D4DB1684828056F8854104016`.

DBOPFS 1.0.0 includes `strong-type@1.1.0` at the relative path required by the
runtime. DBOPFS Studio preserves that dependency relationship in its bundled
extension files. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for terms.

The adapted module and other extension-specific integration code are DBOPFS
Studio source and are not represented by the upstream hashes above. Release
packaging should verify both the retained originals and adapted module against
the recorded hashes before publication.
