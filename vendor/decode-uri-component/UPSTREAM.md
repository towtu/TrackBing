# CommonJS compatibility copy

This is **decode-uri-component 0.5.0**, MIT licensed, by Sam Verschueren.
TrackBing needs the upstream security fix while Expo Router 6's query-string 7
still requires a directly callable CommonJS export. A direct registry override
to 0.5.0 returns an ESM namespace to that caller and breaks query-string decoding.

The only source change in `index.cjs` is replacing
`export default function decodeUriComponent(` with
`module.exports = function decodeUriComponent(`. There are no algorithm changes,
install scripts, network requests or additional dependencies. `LICENSE` is the
unchanged upstream license. Retain this notice and license in distributions.

## Provenance

- Source: [upstream v0.5.0](https://github.com/SamVerschueren/decode-uri-component/blob/v0.5.0/index.js)
- Security fix: [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
- Registry archive: `https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.5.0.tgz`
- Archive SHA-512 (base64): `1BiQVoK8C9gUbQU6NzAtO/tkz2qOFpEObMWpcFvhx4fYnj4Oc5yzaJN/LD36ihkVUdXyh5ZekzX+yM+ty/SrPg==`
- Unmodified `index.js` SHA-256: `9401353df38f8010ad7035fe8d666bce6a4902bc1cff809afc4ab23fa2e0bdaa`
- Unmodified license SHA-256: `ed7a9a0f74e43951b2520efe1a4349cb9ed5f3dff0b0f268e2e51a4d38df7ea4`

The offline provenance test reverses the single export substitution and checks
both hashes. The runtime tests exercise the installed query-string dependency,
including malformed UTF-8, normal food/barcode/recovery parameters and a bounded
malicious-input process. Expo Router 6.0.24 currently calls query-string's
stringifier and parses inbound queries using `URL.searchParams`; the stress
test proves dependency behavior, not a reproduced navigation hang. Upstream
0.5.0 preserves literal `+` in a component; query-string handles form-query
`+` → space conversion itself. The app does not use its fragment parser.

A clean npm install must resolve this local package;
there must be no installed decoder 0.2.x left behind.

## Installation and audit visibility

The root dependency uses `../decode-uri-component-0.5.0.tgz`, generated with
`npm pack ./vendor/decode-uri-component --pack-destination ./vendor`.
Its source directory remains committed for review. The archive contains that
same source, package manifest, license and this notice; it has no install script.
The lockfile verifies the archive's integrity during a clean install, and tests
compare the installed source and license with the reviewed files.

Use an archive rather than a directory link: npm audit skips linked local
packages and their targets. A normal installed package retains the upstream
name and version so registry advisories continue to apply to it. Source hashes
and runtime tests establish this fix; an audit count alone does not. Recheck
upstream advisory/source changes before every release.

## Updating and removal

Recheck the advisory and upstream source before changing this copy. Download a
pinned registry archive, verify its published integrity, review its changes and
license, update the source/hash regression checks, and regenerate the archive
with the command above. Do not fetch or
transpile code during installation or application startup.

Remove this local dependency and its override when a compatible router update
uses the patched upstream package directly. Test query decoding, auth/recovery
navigation and web/native exports before removing it. This source copy must not
be counted as a fix merely because a package name disappears from an audit.
