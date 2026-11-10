// Plays the part of an independent labeller. It signs Footube's labels with a
// key kept off the phone and writes the result into the Footube app. Run it
// with `npm run sign-labels` after changing the labels.
import { readFileSync, writeFileSync } from 'node:fs';

import { loadOrCreateSigningKey, signText } from '../src/crypto';
import { labelBatchMessage, labelHash } from '../src/policy';

const labellerId = 'did:example:chaise-labeller';
const keyPath = new URL('../keys/labeller.pem', import.meta.url).pathname;
const key = loadOrCreateSigningKey(keyPath);

const file = new URL('../../platform/src/family/footubeLabels.json', import.meta.url).pathname;
const items = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];

const hashes = items.map(labelHash);
const batch = { labeller: labellerId, hashes, signature: signText(key, labelBatchMessage({ labeller: labellerId, hashes })) };

writeFileSync(new URL('../../platform/src/family/footubeLabelBatch.json', import.meta.url).pathname, `${JSON.stringify(batch, null, 2)}\n`);
console.log(`Signed ${items.length} items. Labeller public key:\n${JSON.stringify({ id: labellerId, jwk: key.publicJwk })}`);
