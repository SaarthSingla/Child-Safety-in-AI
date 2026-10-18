# Wallet

iOS wallet for the CHAISE age-verification demo (Expo SDK 57, development build).

- Gets an age credential from the issuer after an on-device liveness check
  (random facial actions plus a TrueDepth depth check).
- The holder key lives in the Secure Enclave and never leaves it.
- Answers age requests from the platform with an SD-JWT presentation and key binding.
- Guardian policies (the Policies tab) can block content on the device.

## Run

Needs a Mac with Xcode and an iPhone with Face ID.

```bash
npm install
npx expo run:ios --device --configuration Release   # first run generates ios/
npm test                                            # unit tests
```

Set the issuer's HTTPS address in **Settings** in the app, or change
`DEFAULT_ISSUER_BASE_URL` in `src/config/issuerConfig.ts`. The issuer's public key
is pinned in `src/crypto/sdJwt.ts`.

Install the platform app as well; the two talk through the `childsafewallet://`
and `footube://` deep links.
