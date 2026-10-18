# Platform (Footube)

A demo content site with articles rated Everyone, 12+ and 18+. Restricted
articles open only after the wallet returns a valid age proof.

The platform checks the issuer's signature, the key binding, the nonce and the
audience; each request is single use. It sends the article's category to the
wallet, which applies the guardian's policy, and opens the article only if the
age check and the wallet both allow it.

## Run

```bash
npm install
npx expo run:ios --device --configuration Release
npm test
```

The issuer's public key is pinned in `src/verifier/config.ts`; update it whenever
the demo issuer restarts. The wallet app must be installed on the same iPhone.
