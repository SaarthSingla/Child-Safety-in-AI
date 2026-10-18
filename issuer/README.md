# childsafe_age_release_v1_1

Deterministic CLIP ViT-B/16 age-band model + confidential-runtime software.
Turns an enrolment selfie into an issuer-signed SD-JWT VC. The runtime's
ONLY successful external output is the signed VC.

## Azure Confidential GPU VM copies

    model/ detector/ policy/ runtime/ credential/
    manifest.json  requirements-runtime.txt  README.md  tests/

Training data, aligned/raw images, the notebook, optimiser state and the dev
signing PRIVATE key are NOT in this tree.

## Canonical production preprocessing (frozen)

    raw bytes -> decode RGB -> YOLO ONNX detector -> NMS -> one significant
    primary face -> 25% margin crop with INTEGER TRUNCATION (not round) ->
    resize 224x224 BICUBIC -> float32/255 -> ImageNet norm -> NCHW -> CLIP

Fail-closed: NO_FACE / MULTIPLE_FACES / BAD_IMAGE / FACE_TOO_SMALL. No
whole-image fallback.

## Contract

* `runtime.service.ConfidentialAgeCredentialService.issue_credential(
  image_bytes, session, holder_public_jwk) -> str` is the ONLY entry point.
* Session: `validate()` (no consume) ... sign ... `consume()` atomically.
* `prediction_confidence` = softmax(logits / T)[pred], rounded to 2 dp.
* No logits / probability vector / image|crop|tensor hash in the VC.

## Integrity

    PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. pytest tests/
    manifest.json lists every file + sha256; RELEASE_SHA256 = sha256 of the
    canonical manifest. Any missing / extra / modified file fails verification.

## Not implemented here (Azure confidential-runtime integration)

SEV-SNP / H100 attestation, Secure Key Release, App Attest / Play Integrity,
liveness / PAD, OID4VCI / OID4VP, production issuer key, transport encryption.

release_id: childsafe-age-runtime-v1.1
