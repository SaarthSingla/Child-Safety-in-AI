# Mobile dependency security

Reviewed on 2026-10-19 and updated on 2026-10-28 for `wallet/` and `platform/`. The issuer is outside this review.

## Applied fixes

Both apps keep Expo SDK 57 and pin compatible React, React DOM, Reanimated, and Worklets versions so `npm ci` succeeds without `--force`.

- `decode-uri-component` is overridden from 0.2.2 to patched 0.5.0. Expo Router 57 uses `query-string` 7.1.3, whose CommonJS import expects the old decoder export. Each app's `postinstall` applies the one-line patch in `patches/expo-router++query-string+7.1.3.patch` to use the new default export. Keep the override and patch together. Remove both when Expo Router no longer needs `query-string`, or when its dependency is updated to support the patched decoder directly.
- `uuid` is overridden from 7.0.3 to patched 11.1.1 under `xcode`. The `xcode` package calls `uuid.v4()`, which remains available in 11.1.1.
- `zod` is overridden from 3.25.76 to patched 4.6.6 ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)). Only Expo CLI's dev-tools plugin schemas use it, through `object`, `string`, `array`, `enum`, `union`, `literal`, `optional` and `strict`, all unchanged in zod 4. Both schema modules load under 4.6.6.

## Open upstream advisories

| Package | Dependency path | Current status |
| --- | --- | --- |
| [`deepmerge`](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) 4.3.1 | Expo config loading (`@expo/config`) → `deepmerge` | No patched release is published. It merges the app's own config at build time; no untrusted input reaches it. |
| [`node-forge`](https://github.com/advisories/GHSA-86w9-cpqp-85rv) 1.4.0 | Expo CLI and code-signing certificate tooling → `node-forge` | No patched release is published. The affected RSA signature verification is in build tooling, not application code. |

These two advisories appear once for each app in Dependabot. `npm audit` counts additional affected dependency nodes through the same chains; that count is not a count of distinct vulnerabilities. Recheck the upstream advisories when updating Expo. Do not apply npm's suggested Expo 44 downgrade to clear the audit output.

## Verification

Run in each app directory:

```sh
npm ci
npm test
npm run typecheck
EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 npx expo export --platform ios
npm audit --package-lock-only
```

The audit command is expected to report the two open upstream advisories until patched versions become available.
