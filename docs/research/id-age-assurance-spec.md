# ChildSafe ID Based Age Assurance Research and Implementation Specification

**Research date:** 19 October 2026  
**Audience:** CHAISE ChildSafe research and engineering team  
**Status:** Design proposal. External integration, legal interpretation, and measured performance require a pilot.

## Executive decision

ChildSafe should add **document backed age assurance as a separate issuance route**, not as a hidden adjustment to its face age estimator. The strongest India first route is a user initiated Aadhaar App verifiable presentation, subject to UIDAI Offline Verification Seeking Entity (OVSE) registration and a tested verifier integration. Ask for a signed age threshold when that is all the product needs. For the current 12+ and four band policy, ask for DOB only when the threshold claim is unavailable, and for a signed portrait or UIDAI FaceAuth outcome when holder binding is required. UIDAI's published Aadhaar mdoc and SD-JWT schemas include `Dob`, `ResidentImage`, and `AgeAbove18`; the app supports Android and iOS and describes same device and cross device flows [1, 2, 3, 4].

An Aadhaar secure QR or signed offline XML is a useful second route. Both can be checked without sending the Aadhaar number to UIDAI, but they are **static signed assertions**. They do not prove that the person standing before the phone owns the credential. Their DOB can be year only or derived from a declared or approximate birth record, which is insufficient to assert an exact birthday or a near boundary age [5, 6, 7]. A live capture plus 1:1 face comparison against the signed portrait can raise assurance, but that comparison and its presentation attack detection (PAD) must be evaluated on children and across population groups; low quality or old child portraits require review or a different route [8, 9].

For an outside India exemplar, a **California mobile driving licence (mDL)** can return a signed age threshold with issuer and device authentication and holder authentication by the source wallet. It is good for adult claims where available, but jurisdiction and wallet support are limited [10, 11]. A **biometric passport**, illustrated by the UK passport, extends the design to children and international users: read chip DG1 DOB and DG2 portrait, validate chip signatures under a trusted issuing state certificate, and compare the live face. OCR of the printed machine readable zone (MRZ) is an access and cross check step, not chip authentication [12, 13, 14].

The immediate engineering blocker is trust in the current enrollment path. The checked in issuer receives an arbitrary uploaded image and does not receive verifiable liveness evidence; the tracked repository also declares native iOS liveness and secure key modules but contains no native implementation files. The release notebook measured a 0.80 confidence gate, while the checked in policy sets 0.60 and the temperature differs. Those gaps should be fixed before shipping a higher assurance credential or comparing model performance [R1, R2, N1].

## 1. What the repository is trying to achieve

The demo has three actors. The **wallet** captures a live selfie, obtains an issuer signed SD-JWT VC, holds the credential on the phone, and enforces guardian rules. The **issuer** detects a face, predicts one of `0_5`, `6_11`, `12_17`, or `18plus`, applies a confidence and minor guard, and signs a one hour credential bound to the wallet public key. The **Footube platform** asks for a 12+ or 18+ proof, verifies the issuer signature, disclosure, holder key binding, audience, nonce, time, and age requirement, then opens the article if local guardian policy allowed sharing [R1-R6]. Its intended privacy property is to avoid passing an ID, DOB, name, or selfie to every relying app.

| Component | Checked in behavior | Implication for ID phase |
|---|---|---|
| Issuer | `POST /issuance/start` and `POST /issue`; image is supplied as multipart upload. Face detector and CLIP ViT run server side. Development signing key is ephemeral. | Add an evidence-specific proofing service and a durable signing and session boundary. Do not label a local OCR value as issuer verified. |
| Wallet | Expo React Native; stores SD-JWT in SecureStore and uses a declared secure key module; deep links present a selected age band. | Add native ID scanning, issuer presentation adapters, encrypted ephemeral evidence handling, and a separate assurance specific credential view. |
| Platform | Verifies SD-JWT and key binding with a pinned development issuer key; only accepts the existing age-band credential type. | Add a trust policy for assurance method and predicate, then migrate away from manually pinned ephemeral keys and custom deep links. |
| Guardian controls | Local policy rules and PIN protected editing. | Age evidence does not establish parental relationship or legal authority. Keep guardian authorization as a separate proof. |

### Repository findings that affect confidence

1. **Capture is not bound to issuance.** The wallet's camera screen takes the selfie from its liveness component, but `/issue` accepts any uploaded image bytes plus a session and holder JWK. There is no signed PAD result, sensor provenance, or comparison to an ID portrait at the issuer. A modified client can attempt a different image. A holder key only prevents copying the resulting credential to another device; it does not prove the pictured person owns that device [R2, R3].
2. **Native code is absent in this checkout.** `wallet/modules/liveness/expo-module.config.json` and `wallet/modules/secure-key/expo-module.config.json` list Apple native modules, while the tracked module directories contain only TypeScript wrappers and JSON. Thus this checkout cannot substantiate README claims of a working TrueDepth check or Secure Enclave key. The design should be verified against a build containing those modules before claiming the property [R1, R3].
3. **Model policy has drifted.** The release notebook's full raw image evaluation used minimum predicted-band confidence **0.80** and temperature about **0.9769**. The checked in policy sets **0.60**, while its note still says 0.80; the checked in calibration temperature is **0.98099**. The current model behavior is therefore not represented by the published release metrics. The manifest may record this changed configuration, but it does not make the notebook measurement apply to it [N1, R2].
4. **Trust and operations remain demo grade.** The issuer creates a new signing key on every restart, keeps sessions in memory, and does not implement its proposed confidential VM. The two apps pin a development public key; the key must be rebuilt into them after issuer restart. Existing deep links are an app demo transport rather than OpenID4VP [R1-R6].
5. **The current presentation reveals the exact band.** A 12+ request reveals either `12_17` or `18plus`, so it reveals more than a Boolean 12+ result. A new signed predicate credential would reduce this disclosure. The 18+ band happens to serve as an 18+ predicate, but it is still linked to the same reusable SD-JWT [R4, R5].

## 2. What the notebooks establish

Fourteen notebooks in the workspace parent directory form a coherent experimental sequence. Their images and model checkpoints were produced in Kaggle and are not all shipped in this repository. The figures below are **reported notebook outputs**, not results independently reproduced in this review. The evaluation uses subject grouped train/validation/test rows, but those sets are drawn mainly from UTKFace, AgeDB, FG-NET, and MORPH; their provenance, demographics, label quality, and capture distribution differ from Indian mobile enrollment and from genuine ID portraits [N1-N14].

| Notebook group | Question and observed result | Design consequence |
|---|---|
| `age_bands_model_zoo`, `transformer_finetuning`, `clip_vit_learning_and_attention` | Compared CNN and transformer backbones and fine tuning. CLIP ViT with layer wise learning rate decay reached about 0.87 test macro recall in several runs; an early zoo ensemble reached 0.833. | Treat CLIP as a useful screening baseline, not an identity or DOB source. Reproduce the chosen model and threshold before operational decisions. |
| `band_6_11_improvement`, `data_scaling_study`, `error_analysis` | Examine scarcity of 6–11 data, augmentation, data scale, and errors. The release split has only 188 test images aged 6–11. The error analysis reports concentration around the 12–17/18+ boundary and in adults aged 18–24. | Age bands need selective abstention and a document route near the legal boundary. Collect a representative, consented test set rather than assuming a benchmark transfers. |
| `ordinal_head_comparison`, `feature_attribution` | Explore ordinal age heads and which facial regions carry predictions. The attribution run found color and regional ablations change safety metrics; a small number of embedding dimensions tracks exact age. | Investigate ordinal threshold estimation, but audit for bias and representation leakage. Age features are not automatically anonymous. |
| `mixture_of_experts`, `shrink_to_uniform_stacking` | Compare specialist ensembles and learned combiners. Marginal test gains cost multiple models and can move minor leakage and adult rejection in opposite directions. | Optimize the actual false adult issuance and fallback rates, not macro recall alone. |
| `vlm_age_benchmark` | Tests two zero shot VLMs against the trained CLIP on a matched sample. | A general VLM is not yet a replacement for the measured task model, and sending IDs to a general cloud VLM would expand data exposure. |
| `clip_vit_age_vc_release` | Packages face detector, classifier, temperature, policy, and SD-JWT service. On 3,979 raw test photos, preprocessing succeeded on 3,912; accuracy was 0.8594 and macro recall 0.8666. At the notebook's 0.80 confidence policy, reported minor-to-18+ issuance was 0.0105, coverage 0.8034, adult rejection 0.1885. | This is a research release gate, not an acceptable real-world safety guarantee. Its policy differs from the current file. |
| `clip_vit_direct_split_study` | Splits the 85.8M parameter CLIP at transformer layers. The interface is 197 x 768 FP16 values, **302,592 bytes per face**; the full FP16 model is about **171.6 MB**. Reconstruction and same-person linkability are tested. | A split tensor is potentially biometric data, not a privacy proof; the network and model partition cost remain high. |
| `split_age_phone_issuer_research` | Distills a roughly 1.0M parameter phone encoder with a 128 value FP16, **256 byte** upload and small issuer head. Test macro recall falls from teacher 0.8638 to 0.8231; minor-to-18+ issuance rises from 0.0109 to 0.0164 under its evaluated policy. A separately trained reconstruction attack obtains test PSNR about 13.8 dB and same-person linkability AUC 0.7187. | Small transmitted embeddings still leak identity information and underperform the teacher. Do not deploy this as a privacy-preserving substitute without stronger audit and revised safety policy. |

The key modeling result is conceptual: a face model estimates apparent age, whereas an authenticated ID asserts a recorded birth fact. Neither alone establishes that the person presenting it is the subject. The ID route can reduce boundary error when its document, DOB precision, and holder binding are sound; it cannot repair weak source data or weak identity binding. NIST describes these as evidence validation, attribute validation, and applicant identity verification [8].

## 3. Security model and assurance decisions

ChildSafe should make each decision from four independently recorded properties:

| Property | Question | Example evidence | Failure if omitted |
|---|---|---|---|
| Source authenticity | Did a trusted issuer sign or confirm these attributes? | UIDAI VC signature, UIDAI XML or QR signature, DMV mDL signature, ePassport chip passive authentication, or issuer API. | Edited DOB or convincing forged card passes OCR. |
| Attribute precision | Is the birth information sufficient for the requested boundary on the evaluation date? | Full verified DOB; signed `AgeAbove18`; or conservatively interpreted year of birth. | A year only record is treated as a complete birthday. |
| Holder binding | Is the live applicant the subject of that evidence? | Issuer performed FaceAuth; cryptographic mDL wallet presentation tied to enrolled biometric; or PAD plus 1:1 live face to signed portrait. | Borrowed or stolen genuine ID passes. |
| Wallet binding | Is the issued ChildSafe credential being used by the authorized device holder? | Attested hardware key, challenge response, local user authentication, nonce and audience. | A copied token or a credential enrolled with a software key is reused. |

**Assurance profile A:** facial age estimate only, explicitly marked `facial_age_estimation`. It can route uncertain cases to proofing and can issue conservative bands for the demo. It is not verified DOB. **Profile B:** a cryptographically valid issuer ID attribute with holder binding by a measured PAD and face match, or issuer-native FaceAuth. **Profile C:** the same with fresh source status and hardware bound wallet key plus verified app and capture controls. Assurance must be a policy tuple, not a single vague integer: `{source, attribute_precision, holder_method, capture_integrity, freshness, device_binding}`. A verifier can require Profile B or C for a higher risk age gate. Any missing or failed required component yields `UNKNOWN`, a retry, or a humane attended alternative, never an adult assumption.

Threats to test include edited digital files, a photograph of another person's signed QR, borrowed mDL device, synthetic face or replayed video, camera injection on a modified client, face match between relatives or twins, old childhood portrait, MITM and request replay, forged issuer key or stale revocation, cross verifier correlation, model extraction, logs and crash traces containing PII, and guardian impersonation. A face biometric unlock of the *phone* only proves someone allowed by that device is present; it does not, by itself, tie that person to the ID photo [8, 15, 16].

## 4. India document selection

| Evidence | DOB and portrait | Authenticity path | Holder proof and limits | Recommended use |
|---|---|---|---|---|
| **Aadhaar App VC** | UIDAI schemas list `Dob`, `ResidentImage`, and `AgeAbove18` as selectively disclosable. | Verify UIDAI SD-JWT or mdoc signature, trust key, validity and status, request binding, and signed claim digests using UIDAI's published profile. UIDAI describes FaceAuth in presentation flows. | Use issuer-native FaceAuth outcome and wallet/device proof where available; test exact semantics, freshness, and minor profile behavior. Requires OVSE registration and UIDAI integration. | Preferred India pilot, especially signed 18+ predicate. |
| **Aadhaar secure QR** | Demographics, photo, DOB or year of birth. | Scan and validate UIDAI digital signature using the authorized verifier implementation. | Static card or screenshot may be borrowed. Obtain live face and compare to signed photo; no freshness or revocation unless separately checked. | Offline fallback with lower assurance. |
| **Aadhaar paperless offline XML** | Signed XML has name, photo, `dob` as DDMMYYYY or YYYY, and other attributes. | Consent based download; decrypt ZIP with share phrase; validate XML signature against current UIDAI certificate and safe XML parser. | Same static ownership problem; XML may expose unnecessary address and hashed contacts to the verifier. Do not persist file or share phrase. | Controlled fallback when QR photo quality is inadequate. |
| **DigiLocker issued document** | Depends on issuer: DL, PAN, school or birth document may have DOB; some lack a usable portrait. | Fetch from **Issued Documents** using an approved DigiLocker requester flow or verify issuer signature or QR; a user upload in DigiLocker Drive is not issuer evidence. | Account or OTP alone may belong to guardian; attach subject and portrait or a separate binding flow. | Secondary route and source cross check. |
| **PAN or e-PAN** | DOB and usually card portrait; PAN 2.0 QR can display details. | Income Tax Department's PAN check validates submitted name, DOB and PAN status; approved external agency access is separate. QR verifier may help. | Good for adults; PAN details or an OTP to an arbitrary phone do not prove face ownership. Minor PAN exists, while **instant e-PAN** excludes minors. | Adult fallback after verified database or QR path and face match. |
| **Driving licence / mParivahan** | Typically DOB and photo. | Prefer issuer sourced virtual DL via DigiLocker/mParivahan or authorized Sarathi verification. | Most holders are older teens or adults; not a child general solution. | Adult or older teen fallback. |
| **Indian ePassport** | DOB, portrait, chip for biometric passports. | ICAO Doc 9303 chip authentication with trusted Indian CSCA certificates; printed MRZ only supports access and cross checks. | Live face vs chip portrait, PAD, chip presence. | Strong optional document route where NFC and PKI operations exist. |
| **Birth certificate / school record** | DOB but often no portrait. | Issuer sourced DigiLocker record or registrar validation. | Cannot directly bind to child by a selfie; needs guardian relationship and another child identity step. | Assisted minor path, especially when Aadhaar photo is old or unavailable. |
| **Voter EPIC** | May show age or date rather than reliable full DOB; adults only. | Elector service or signed issuer record where available. | Poor fit for exact DOB extraction and all child flows. | Do not prioritize. |

The Aadhaar number itself must not be a stored correlation key. UIDAI says offline XML does not require collection of the number, and the Aadhaar App VC does not transmit the 12 digit number to an OVSE [5, 17]. A service must disclose its purpose, obtain consent and offer viable alternative identification for people unable or unwilling to use Aadhaar. For a child, UIDAI's regulations refer to parent or guardian consent [18].

### Aadhaar App verification pipeline

1. Register the relevant ChildSafe entity as an OVSE and obtain UIDAI's current verifier handbook, trust material, test credentials, and production approval. Treat the UIDAI profile as a separate upstream credential; its `typ`, claim encoding, status, and key discovery differ from ChildSafe's SD-JWT implementation [1-4, 17].
2. Create a signed, short lived presentation request with a single use nonce, audience, purpose, requested attributes, response endpoint, and issuer allowlist. For 18+ ask for the signed age predicate. For 12+ request `Dob` only if there is no signed 12+ predicate. Request `ResidentImage` only if a fresh issuer holder proof is unavailable or insufficient for ChildSafe's assurance policy.
3. Receive the Aadhaar App response through the prescribed same device or cross device callback, verify its protocol envelope and signature, issuer key and status, presentation nonce and audience, holder/device signature, clock window, and exactly the disclosed claims. Do not accept a UI screenshot or an unsigned JSON field as a VC.
4. Interpret the birth attribute using the precision rules below. If `AgeAbove18` is used, verify its **meaning at the time of presentation** in an integration test; do not assume the literal label's strict `>` semantics, or cache it across the eighteenth birthday. UIDAI's separate authentication API describes an age predicate as `>=` the requested age, but this does not automatically define the VC field [2, 19].
5. Confirm holder proof: ideally UIDAI's fresh FaceAuth result bound to this transaction, or a PAD tested live face compared with the issuer signed portrait. Bind the final ChildSafe issuance to the wallet's attested P-256 key and the same nonce. Sign only a minimal derived claim and provenance category, then delete raw upstream presentation material.

### Offline XML or QR fallback pipeline

Use a locally bundled and updated UIDAI trust store with certificate rollover. Decode signed fields before any OCR. For XML, use a hardened XML parser that disables external entities and network resolution, validates the XML signature reference and transforms exactly as specified, checks document size and decompression limits, and rejects ambiguous duplicate or malformed nodes. For QR, use a maintained UIDAI reader or published verification specification and verify signature before trusting any DOB or portrait. Capture a live selfie and signed source portrait in one transaction, run PAD plus 1:1 comparison at a validated threshold, record only pass/fail and quality metadata, and offer an assisted route after uncertain results. XML ZIP and share code should be short lived and never enter analytics, logs, backups, or support screenshots [5, 6, 8, 18].

## 5. Outside India exemplars

**California mDL.** For a California user who has an eligible state ID in Apple, Google, Samsung or California DMV wallet, request an age threshold through the platform's supported reader or online flow. The verifier must validate the DMV signing chain/IACA root, issuer signed attributes, document status and time, the device presentation signature and session transcript, nonce, audience, and user consent. Apple says Wallet onboarding checks ID ownership and the presentation requires the same Face ID/Touch ID enrollment; that is a useful source-wallet holder proof, though ChildSafe still needs to evaluate its application context and replay defenses [10, 11, 20]. Apple and Google offer threshold APIs; prefer them over DOB. Google lists Android 9+ for ISO mdoc over OpenID4VP where supported, while Apple limits Verify with Wallet to supported regions, IDs and OS/device combinations [20, 21]. Do not generalize CA availability to every US state or minor. A driver's licence is inherently inaccessible to many children.

**UK biometric passport.** A passport provides a concrete child-capable path outside India. Photograph the passport's MRZ and read it with OCR only to establish the chip access key and check digits. Read the NFC chip; DG1 contains the MRZ attributes including DOB, DG2 the face image. Verify the chip's signed security object and data group hashes with the UK document signer chain and trusted CSCA, then perform live face PAD and 1:1 comparison with DG2. Active or chip authentication, if supported, provides additional clone resistance. The GOV.UK ID Check app demonstrates the passport photo, chip, and live face workflow on phones; ICAO specifies the cryptographic structure. An MRZ check digit is an error detector, not proof of authenticity. Verify expiry and policy on expired documents [12-14, 22].

## 6. Computer science design for DOB extraction and identity matching

### Typed DOB and threshold algorithm

Represent DOB as `{value, precision, source_verified, issuer, observed_at, valid_until}`. `precision` is `DAY`, `YEAR`, or `PREDICATE`. Reject noncalendar dates, locale ambiguous formats, future dates, missing century, and conflicts between text, MRZ, signed QR, and chip. Perform date arithmetic in the relevant civil calendar with a specified timezone and leap day rule. Do not compute age as `(today - dob)/365.25`.

For a full DOB and age threshold `t`, the person qualifies if `dob <= today minus t calendar years`. For a year only `Y`, the true DOB lies in `[Y-01-01, Y-12-31]`; return **PASS** only if even `Y-12-31` meets the threshold, **FAIL** only if even `Y-01-01` is below it, and **UNKNOWN** otherwise. For a signed source threshold predicate, validate signature, subject binding, time, and source semantics before returning PASS. Keep internal DOB only until credential derivation; the ChildSafe VC should disclose a predicate or coarse band. A 12–17 band expires no later than the earliest date on which it can become 18; reissue rather than silently stretching the band [5, 19].

### Vision and authentication pipeline

1. **Acquisition and quality:** live camera capture; detect document type and edges, rectify perspective, reject glare, blur, occlusion, screen replay and multiple faces; use capture session and quality metadata. NIST calls for live document capture and document presence checks in remote optical proofing [8].
2. **Primary data extraction:** prefer signed mdoc/SD-JWT/XML/QR/chip structured fields. OCR is a fallback or consistency check. Apple Vision runs text and barcode detection on device; Google ML Kit supports Latin and Devanagari OCR on Android and iOS [23, 24]. A language model should never invent a DOB absent from a signed source.
3. **Cross checks:** compare OCR text with signed claims or MRZ/chip; enforce document template and check digit rules; detect field collisions, substitution and inconsistent issue or expiry dates. Cryptographic source validation is still mandatory.
4. **Holder matching:** capture one live face with passive and, where appropriate, random active PAD; compare its embedding 1:1 against the signed document portrait. Do not use 1:N face search. Tune a single operational threshold on representative genuine and impostor pairs, then report false match rate, false nonmatch rate, PAD attack success, and subgroup performance. NIST's SP 800-63A-4 specifies explicit biometric consent, disclosure, operational tests and an IAPAR under 0.07 for remote PAD under its applicable profile; use those as evaluation reference rather than as proof of ChildSafe compliance [8, 9, 25].
5. **Decision and fallback:** if signature, attribute or holder proof fails, reject. If quality or matching is uncertain, retry within limits or use trained human review with consent and minimization. Do not turn a face model's apparent-age confidence into a document match score.

### Metrics and experiments needed before deployment

Pre-register the threat model, threshold and acceptance limits before test evaluation. Report (a) false adult issuance per true minor, separately at ages 12–14 and 15–17, (b) adult false rejection and human-review rate, (c) document forgery acceptance and source verification failures, (d) PAD attack success by print, replay, mask, synthetic and injection attack, (e) 1:1 false match/nonmatch including relatives, twins and old child portraits, (f) DOB precision and OCR substitution error, (g) latency, battery and memory on named devices, and (h) worst subgroup rates by age, skin tone, sex, document type and capture conditions. Measure end-to-end confidence intervals, not just component accuracy. The current notebook's 1.05% minor-to-adult credential issuance at one research operating point is far too large to infer safety for a production child gate, and the checked in threshold is different [N1, 8, 9, 26].

## 7. How to add this to ChildSafe

Keep upstream identity evidence inside an **evidence adapter** and issue a new credential version. Do not reuse `urn:childsafe:age-credential:v1` with a different meaning. Proposed `urn:childsafe:age-assurance:v2` has only issuer, issue and expiry times, a holder confirmation key, a selectively disclosable `age_over_12` or `age_over_18` result or four band where essential, and nonidentifying `assurance_method`/`evidence_class` values. Avoid DOB, name, portrait, document number, Aadhaar reference ID, upstream credential ID or status URL, hashes of IDs or images, face embedding, and exact OCR text in the ChildSafe VC. A stable upstream identifier is a cross service tracking key even if hashed without a secret. If anti-reuse is necessary, use a scoped, rotating, keyed token under strict purpose and retention controls.

```text
User and source ID -> ChildSafe wallet evidence adapter -> source verification
                  -> live holder proof + attested holder key -> issuer policy
                  -> signed minimal ChildSafe VC -> wallet SecureStore
Verifier request -> wallet consent + guardian policy -> key bound predicate
                  -> verifier signature, nonce, audience, status and policy check
```

| Change area | Concrete change |
|---|---|
| `wallet/src/app` | Add "verify with ID" choice, document and source consent, accessible retry and appeal, age precision explanation, and no forced Aadhaar path. Keep guardian flow separate. |
| `wallet/src/api` | Add issuer-specific adapters: UIDAI App VP callback, UIDAI offline QR/XML, approved DigiLocker requester, mDL, passport NFC. Accept only typed `VerifiedEvidence`, never a raw string DOB. |
| Native wallet modules | Implement and track iOS camera/PAD, Secure Enclave and NFC where needed; Android CameraX, Keystore/StrongBox, integrity, NFC, document parsing. Verify module functionality on devices. |
| Issuer | Add `/id/issuance/start` and `/id/issue` with signed request, server side source verification or attested local result, transaction binding, idempotent atomic consume, and dedicated policy. Separate face estimate and ID proofing logs. |
| Credential | New VCT and trust metadata for ID based assurance. Issuer key rotation, public discovery, revocation/status policy, maximum age, source version, and protocol conformance. |
| Platform | Accept v1 or v2 by explicit policy. For a protected 18+ resource require `age_over_18=true` from an allowed evidence class or approved v1 mode; never infer adult from missing child evidence. |
| Transport | Move from URL query containing an entire presentation to OpenID4VP 1.0 with an authenticated request, response encryption or direct POST, origin binding and replay store. OID4VCI 1.0 can govern issuance [27]. |

**Transaction binding contract:** issuer nonce, wallet key thumbprint, source request ID, capture session ID, approved assurance method and hash of exact upstream response are bound inside the issuer transaction. The hash remains inside the restricted proofing service; it is not a VC claim. Consume the single use session atomically with credential commit. Require user authentication when the holder key signs a presentation, and consider re-proofing after device migration, biometric enrollment change, risk event, or evidence expiry. The device key proves possession, while the source face proof links the person to the ID; both are needed.

## 8. Where the model runs and device support

| Deployment | What leaves the phone | Main advantage | Main limitation / status |
|---|---|---|---|
| **Source native credential + local verifier** | A signed upstream presentation and minimal decision may reach ChildSafe issuer; no raw ID image if issuer-native FaceAuth and holder proof suffice. | Strong source authenticity and less ChildSafe image handling. | UIDAI integration rules, online FaceAuth and source app behavior still determine privacy. Profile needs interoperability test. |
| **All local parse, OCR, PAD and face match; remote signed issuance** | Only a device attested result and evidence receipt. | No raw document or face sent to ChildSafe. | App or camera compromise can forge result; hardware key and App Attest/Play Integrity do not independently certify the image or model execution. Treat as lower assurance absent trusted sensor/TEE evidence and external evaluation [15, 16]. |
| **Confidential remote proofing** | Encrypted ID fields/photo or selfie to a measured TEE service. | A controlled signer can verify and audit the full decision while reducing operator exposure. | Sensitive data still leaves device; attestation, key release, no logging, lifecycle and independent review must be built. Current Azure class is only a placeholder [R2]. |
| **Full local age model** | A signed result or no selfie if credible remote attestation can be established. | Removes selfie upload to ChildSafe. | The current CLIP weights are 343.2 MB FP32 (about 171.6 MB FP16) plus a 12.18 MB detector; mobile conversion, speed, battery and trusted result integrity are unmeasured [N1, N12]. |
| **Phone encoder + issuer head** | 256 byte feature vector plus metadata. | Small phone model and low bandwidth. | The notebook reports worse age safety and measurable reconstruction/linkability. Treat the vector as biometric data, not anonymized data [N13]. |

The **existing demo** is iPhone only and says it needs Face ID; it cannot be assumed to run on Android until native modules exist [R1, R3]. UIDAI says its Aadhaar App onboarding supports Android 9+ and iOS 16+; its separate device specification page says iOS 13+, so pilot the currently supported app store versions and ask UIDAI to resolve the mismatch [1, 28]. California mDL device coverage depends on Apple/Google/DMV programs, not merely an NFC chip [20, 21]. For direct OCR and compact face models, iOS Core ML uses CPU, GPU and Neural Engine and Android LiteRT/ONNX Runtime Mobile can use CPU, GPU or supported NPUs; actual per-device behavior and numerical parity must be benchmarked [29, 30]. Android Keystore hardware keys and iOS Secure Enclave can protect holder keys; neither provides a general enclave for arbitrary OCR or CLIP inference [15, 31].

### Model choices and a realistic device qualification matrix

| Task | Candidate implementation | What must be validated before use |
|---|---|---|
| DOB field reading | Parse signed UIDAI VC, QR or XML, mDL, or passport chip fields first. For images use Apple Vision text recognition or ML Kit Text Recognition v2, with a document type specific date parser and confidence based abstention. | Script coverage, `DDMMYYYY` versus `YYYY`, OCR digit substitutions, layout spoofing, and whether the *signed* field, rather than untrusted pixels, supplied the accepted DOB [5, 23, 24]. |
| Document and face localization | Perspective and quality checks with OpenCV style geometry; the checked in YOLO ONNX face detector can be a starting point for live-face cropping. | Screen or print replay, glare, multiple documents or faces, old child photo quality, and numerical parity after Core ML or LiteRT conversion [R2]. |
| 1:1 identity match | A separately trained and licensed ArcFace style face embedding model; MobileFaceNet is a compact on-device backbone candidate. Compare normalized embeddings with a calibrated cosine threshold. | False matches for relatives, twins, children and aged portraits; false nonmatches across lighting and document types. A published LFW score is not a ChildSafe acceptance threshold. Do **not** reuse the CLIP age embedding as the identity matcher [8, 9, 34, 35]. |
| PAD and injection resistance | A measured passive PAD classifier plus random active prompts where needed, combined with camera/session integrity checks. Source-native FaceAuth can replace this only if its result is signed and bound to the transaction. | Print, replay, display, mask, deepfake, virtual-camera and modified-client attacks under ISO 30107-3 style testing. No generic PAD model can be treated as certified solely because it runs on device [8, 25]. |
| Apparent-age screen | Keep the measured CLIP ViT as a server research baseline; trial the notebook's compact phone encoder only after rebalancing and safety testing. An ordinal threshold head is a research candidate. | Raw mobile capture error, minor-to-adult rate, subgroup calibration, power draw, model distribution size and feature linkability [N1, N8, N13]. |

The support plan should name **capability classes**, then qualify real devices. Camera plus local OCR/QR can run on both Android and iOS without special depth hardware; it is a lower assurance route until holder PAD and source signature checks are demonstrated. Passport chip reading additionally needs NFC smart-card access and country certificate maintenance. A source-app VC route needs that source app and supported wallet/reader flow. TrueDepth can improve iPhone capture signals, but Face ID and a local biometric unlock do not expose a general proof that the face matches the ID holder. Android depth, NPU and StrongBox availability vary by manufacturer. A pilot matrix should include an older supported iPhone, a current Face ID iPhone, a midrange Android, and a flagship Android; record exact OS, NFC, secure-key, camera and model latency results. Treat these as **test targets**, not a claim that every model in a brand line is supported [1, 15, 16, 28-31, 36].

## 9. Privacy, law and operations

**Purpose and choice.** Present the exact reason for age proofing and the fields requested; prefer a signed predicate over DOB, and a verified DOB over unnecessary whole-document images. Give a non-Aadhaar route. For Aadhaar offline verification, the OVSE must inform the person or guardian, obtain recorded consent, state an alternate viable identity method, and observe purpose limits. OVSE registration and current regulations need counsel and UIDAI review before launch [17, 18].

**Children and guardian.** An adult showing their own ID is not proof of parentage. A child birth certificate is not proof that the presenting adult has lawful authority. The wallet needs a separate verified relationship and consent flow, with revocation and custody/dispute handling. India DPDP Act section 9 provides for verifiable parental consent and restricts harmful child processing, tracking, and targeted advertising; the notified Rules have a phased commencement. As of this research date, implementation should prepare for the child obligations scheduled eighteen months after the November 2025 Gazette publication while legal counsel checks the operative notices and exceptions [32, 33].

**Data lifecycle.** Default to RAM only for ID image, DOB, portrait and face crop. Block photos from gallery backup, screenshots, debug logging and crash payloads. Separate analytics events from proofing events; log only random transaction ID, route, policy version, high level outcome and coarse error category. Encrypt any unavoidable retry material with a short TTL and access audit. Delete source presentation and temporary crops after issuance or failure; retain only the minimal signed ChildSafe VC and a consent receipt required by law. Use issuer key rotation, revocation/status caching rules, replay protection, rate limits, security review, incident response and periodic privacy assessment. A user deletion and correction flow must remove local data and direct corrections to the source issuer rather than editing a signed DOB in ChildSafe.

**Interoperability.** UIDAI's public SD-JWT page and its mdoc page are useful integration leads but contain profile-specific field names and examples. Build a verifier against UIDAI-provided conformance samples and current keys, not a hand-wavy generic SD-JWT parser. In particular, the upstream Aadhaar VC is not ChildSafe's `dc+sd-jwt` VCT. OpenID4VP and OpenID4VCI final specifications can replace the demo's custom deep link exchange, but verifier trust and legal OVSE status are separate requirements [2-4, 27].

## 10. Delivery plan and acceptance gates

| Stage | Deliverable | Gate to move on |
|---|---|---|
| 0. Baseline | Reconcile notebook and repository release hashes, 0.80 versus 0.60 policy, calibration, missing native modules and key rotation; reproduce current tests. | One pinned build and a measured raw-capture safety table; no undocumented configuration drift. |
| 1. Evidence adapters | Prototype UIDAI App VP with OVSE test access, signed offline QR/XML verifier, and one non-India mDL/passport fixture. Implement typed DOB precision and signed source verification. | Forged/altered/expired evidence, wrong issuer, stale status and replay all fail closed. |
| 2. Holder proof | Integrate source FaceAuth where available and independent 1:1 PAD route otherwise; build device key attestation and transaction binding. | Pre-registered PAD, face-match and subgroup metrics meet approved limits; injection tests and assisted fallback work. |
| 3. Credential v2 | Sign minimal predicate VC; update wallet and verifier policy, status and transport. | End-to-end tests show no DOB, ID number, portrait, source identifier or stable cross-verifier handle in VC or logs. |
| 4. Field pilot | Consent based Indian device and document sample spanning minors and ages 17–21, plus CA/UK fixtures; threat and usability review. | Report false adult issuance with confidence intervals, false rejection, latency, accessibility, incident and redress outcomes; independent security and legal sign-off. |

**Decisions the team must make:** the acceptable false adult issuance upper bound for each content risk; whether UIDAI OVSE eligibility and source-native FaceAuth can be obtained; whether v2 issues only predicates or retains bands for 0–11/12–17 policy; the support boundary for weak or year-only DOB; whether a confidential remote fallback is acceptable; and which proof establishes guardian relationship. None of these can be substituted by a stronger OCR model.

## Source register

**Repository and notebook evidence** (relative to this document):

- [R1] [Repository overview](../../README.md) and [getting started](../../GETTING_STARTED.md), current demo description and limitations.
- [R2] [Issuer API](../../issuer/api.py), [service](../../issuer/runtime/service.py), [policy](../../issuer/policy/issuance_policy.json), [calibration](../../issuer/policy/calibration.json), [signer](../../issuer/runtime/signer.py).
- [R3] [Wallet camera](../../wallet/src/app/camera.tsx), [issuer client](../../wallet/src/api/issuer.ts), [native liveness manifest](../../wallet/modules/liveness/expo-module.config.json), [native key manifest](../../wallet/modules/secure-key/expo-module.config.json).
- [R4] [Wallet proof](../../wallet/src/app/verify-request.tsx), [holder key](../../wallet/src/crypto/holderKey.ts), [credential store](../../wallet/src/crypto/credentialStore.ts).
- [R5] [Platform proof verifier](../../platform/src/verifier/verifyPresentation.ts), [verifier trust config](../../platform/src/verifier/config.ts).
- [R6] [Issuer credential type](../../issuer/credential/credential_type.json), [wallet age requirements](../../wallet/src/config/ageRequirements.ts), [guardian policy store](../../wallet/src/policy/store.ts).
- [N1] [Age VC release notebook](../../../clip_vit_age_vc_release.ipynb), sections 3–5 and 11, measured split and raw path metrics.
- [N2] [Age bands model zoo](../../../age_bands_model_zoo.ipynb).
- [N3] [Transformer fine tuning](../../../transformer_finetuning.ipynb).
- [N4] [CLIP learning and attention](../../../clip_vit_learning_and_attention.ipynb).
- [N5] [6–11 improvement](../../../band_6_11_improvement.ipynb).
- [N6] [Data scaling](../../../data_scaling_study.ipynb).
- [N7] [Error analysis](../../../error_analysis.ipynb).
- [N8] [Ordinal heads](../../../ordinal_head_comparison.ipynb).
- [N9] [Feature attribution](../../../feature_attribution.ipynb).
- [N10] [Mixture of experts](../../../mixture_of_experts.ipynb).
- [N11] [Shrink to uniform stacking](../../../shrink_to_uniform_stacking.ipynb).
- [N12] [Direct CLIP split study](../../../clip_vit_direct_split_study.ipynb).
- [N13] [Phone encoder and issuer head](../../../split_age_phone_issuer_research.ipynb).
- [N14] [VLM age benchmark](../../../vlm_age_benchmark.ipynb).

**External primary sources** (accessed 19 October 2026):

1. [UIDAI Aadhaar App FAQ](https://uidai.gov.in/hi/aadhaar-app-faq), app capabilities, FaceAuth, device requirements and child profiles.
2. [UIDAI Aadhaar SD-JWT specification](https://docs.uidai.gov.in/readme/verifiable-credential-specifications/aadhaar-sd-jwt-specifications), claim set, holder binding and status.
3. [UIDAI Aadhaar mdoc specification](https://docs.uidai.gov.in/readme/verifiable-credential-specifications/iso-18013-5-aadhaar-mdoc-specs), signed claims and device binding.
4. [UIDAI same device flow](https://docs.uidai.gov.in/readme/app-to-app-credential-flows/openid4vp-specifications/openid4vp-same-device-flow-specifications) and [wallet flow](https://docs.uidai.gov.in/readme/app-to-app-credential-flows/uidai-specifications/wallet-flow-specifications).
5. [UIDAI paperless offline e-KYC](https://uidai.gov.in/en/aadhaar-paperless-offline-e-kyc), XML schema, signature, DOB/YoB and photo.
6. [UIDAI secure QR reader](https://uidai.gov.in/hi/qr-code-reader), digitally signed QR and demographics.
7. [UIDAI enrolment and update guidance](https://uidai.gov.in/en/media-resources/media/press-releases/295-english-uk/faqs/enrolment-update.html?start=60), verified, declared and approximate DOB.
8. [NIST SP 800-63A-4 identity proofing requirements](https://pages.nist.gov/800-63-4/sp800-63a/ial-general/), source, applicant and capture controls.
9. [NIST FRTE demographic effects](https://pages.nist.gov/frvt/html/frvt_demographics.html), face-match subgroup effects.
10. [California DMV mDL reader](https://www.dmv.ca.gov/portal/ca-dmv-wallet/mdl-reader/), issuer validation and age use.
11. [AAMVA mDL implementation guidelines](https://www.aamva.org/getmedia/bb4fee66-592d-4d39-813a-8fdfd910268a/MobileDLGuidelines1-5.pdf), mDL data and security profile.
12. [ICAO Doc 9303 Part 10](https://www.icao.int/publications/documents/9303_p10_cons_en.pdf), chip DG1 and DG2 structure.
13. [ICAO Doc 9303 Part 11](https://www.icao.int/Security/FAL/TRIP/PublishingImages/Pages/Publications/Doc%209303%207th%20Part11.pdf), passport authentication procedures.
14. [GOV.UK ID Check guidance](https://www.gov.uk/guidance/using-the-govuk-id-check-app), passport chip and live face workflow.
15. [Apple App Attest](https://developer.apple.com/documentation/DeviceCheck/establishing-your-app-s-integrity), app instance integrity.
16. [Android Play Integrity](https://developer.android.com/google/play/integrity/overview), device and app integrity signals.
17. [UIDAI OVSE registration](https://uidai.gov.in/pa/ovse), registration and use boundaries.
18. [UIDAI 2021 offline verification regulations consolidated](https://uidai.gov.in/images/The_Aadhaar_Authentication_and_Offline_Verifications_Regulations_2021-_Clean_copy-30122025.pdf), consent and alternative means.
19. [UIDAI Authentication API 2.5](https://uidai.gov.in/images/resource/Aadhaar_Authentication_API-2.5_Revision-1_of_January_2022.pdf), verified DOB type and age comparison semantics.
20. [Apple Verify with Wallet](https://developer.apple.com/wallet/get-started-with-verify-with-wallet/), supported devices and source ID ownership proof.
21. [Google Wallet online digital ID verification](https://developers.google.com/wallet/identity/verify/accepting-ids-from-wallet-online), Android availability and age threshold.
22. [GOV.UK One Login privacy notice](https://www.gov.uk/government/publications/govuk-one-login-privacy-notice/govuk-one-login-privacy-notice), document and chip information processed.
23. [Apple Vision text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images), local OCR.
24. [Google ML Kit Text Recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2), Latin and Devanagari OCR.
25. [ISO/IEC 30107-3:2023](https://www.iso.org/standard/79520.html), PAD testing and reporting.
26. [NIST FATE age estimation](https://pages.nist.gov/frvt/html/frvt_age_estimation.html), threshold error tradeoff.
27. [OpenID4VP 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) and [OpenID4VCI 1.0](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0-final.html), credential transport protocols.
28. [UIDAI device specifications](https://docs.uidai.gov.in/readme/device-specifications), alternate published version statement.
29. [Apple Core ML](https://developer.apple.com/documentation/coreml), on-device inference.
30. [ONNX Runtime Mobile](https://onnxruntime.ai/docs/tutorials/mobile/) and [Google LiteRT NPU](https://ai.google.dev/edge/litert/android/npu), mobile acceleration choices.
31. [Android Keystore](https://developer.android.com/privacy-and-security/keystore) and [Android credential key attestation](https://developer.android.com/identity/digital-credentials/credential-issuer/keystore-attestation), hardware key properties.
32. [India Digital Personal Data Protection Act 2023](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf), section 9.
33. [MeitY DPDP Rules and enforcement timeline](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digit), current published legal material.
34. [ArcFace original CVPR paper](https://openaccess.thecvf.com/content_CVPR_2019/papers/Deng_ArcFace_Additive_Angular_Margin_Loss_for_Deep_Face_Recognition_CVPR_2019_paper.pdf), angular-margin face recognition approach.
35. [MobileFaceNets original paper](https://arxiv.org/abs/1804.07573), mobile face-verification backbone and size study.
36. [Apple Core NFC documentation](https://developer.apple.com/documentation/CoreNFC), iOS ISO 7816 tag interfaces.

**Interpretation note:** A signed field proves what that issuer recorded and that the signed bytes were unaltered. It does not prove the source birth fact is accurate, the presenter is the subject, or that a child has an authorized guardian. Those are separate validation and operational decisions.
