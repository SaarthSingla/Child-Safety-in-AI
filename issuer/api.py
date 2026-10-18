import json
import logging
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from runtime.credential import OpenVcSdJwtEncoder
from runtime.errors import CredentialIssuanceError
from runtime.estimator import AgeBandEstimator
from runtime.policy import IssuancePolicy, IssuancePolicyConfig
from runtime.preprocessing import FaceDetectorONNX, PreprocessConfig
from runtime.service import ConfidentialAgeCredentialService
from runtime.session import InMemorySessionValidator, IssuanceSession
from runtime.signer import DevES256Signer
from runtime.calibration import TemperatureScaler


BASE = Path(__file__).resolve().parent

logging.basicConfig(level=logging.INFO)

# Release configuration
detector_cfg = PreprocessConfig.from_json(
    BASE / "detector" / "detector_config.json"
)

policy_cfg = IssuancePolicyConfig.from_json(
    BASE / "policy" / "issuance_policy.json"
)

model_cfg = json.loads(
    (BASE / "model" / "model_config.json").read_text()
)

scaler = TemperatureScaler.from_json(
    BASE / "policy" / "calibration.json"
)

detector = FaceDetectorONNX(
    BASE / "detector" / "face_detector.onnx"
)

estimator = AgeBandEstimator(
    model_cfg,
    BASE / "model" / "clip_vit_age_v1.safetensors",
    scaler,
)

policy = IssuancePolicy(policy_cfg)
encoder = OpenVcSdJwtEncoder()

# DEMO ONLY.
# Production must replace this with the attested production signing design.
signer = DevES256Signer()

# DEMO ONLY.
# Production needs durable/transactional single-use session state.
sessions = InMemorySessionValidator()

service = ConfidentialAgeCredentialService(
    detector=detector,
    preprocess_cfg=detector_cfg,
    estimator=estimator,
    policy=policy,
    encoder=encoder,
    signer=signer,
    session_validator=sessions,
    issuer="https://issuer.childsafe.demo",
)


app = FastAPI(
    title="ChildSafe Confidential Age Runtime",
    version="1.1",
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "childsafe-age-runtime",
        "version": "1.1",
    }


@app.post("/issuance/start")
def issuance_start(
    holder_public_jwk: str = Form(...),
):
    try:
        holder_jwk = json.loads(holder_public_jwk)

        # Validate that the holder JWK can produce the same thumbprint
        # used later during credential issuance.
        from runtime.credential import jwk_thumbprint

        holder_thumbprint = jwk_thumbprint(holder_jwk)

        now = int(time.time())
        expires_at = now + 600

        session = IssuanceSession(
            session_id=f"cs-{now}-{secrets.token_urlsafe(16)}",
            nonce=secrets.token_urlsafe(24),
            holder_key_thumbprint=holder_thumbprint,
            issued_at=now,
            expires_at=expires_at,
        )

        sessions.register(session)

        return {
            "session_id": session.session_id,
            "nonce": session.nonce,
            "issued_at": session.issued_at,
            "expires_at": session.expires_at,
            "holder_key_thumbprint": session.holder_key_thumbprint,
        }

    except Exception:
        logging.exception("issuance start failed")
        return JSONResponse(
            status_code=400,
            content={
                "verdict": "REJECT_INVALID_REQUEST",
                "error_code": "INVALID_REQUEST",
            },
        )


@app.post("/issue")
async def issue(
    image: UploadFile = File(...),
    session_id: str = Form(...),
    nonce: str = Form(...),
    holder_public_jwk: str = Form(...),
    issued_at: int = Form(...),
    expires_at: int = Form(...),
    holder_key_thumbprint: str = Form(...),
):
    try:
        holder_jwk = json.loads(holder_public_jwk)

        session = IssuanceSession(
            session_id=session_id,
            nonce=nonce,
            holder_key_thumbprint=holder_key_thumbprint,
            issued_at=issued_at,
            expires_at=expires_at,
        )

        image_bytes = await image.read()

        vc = service.issue_credential(
            image_bytes=image_bytes,
            session=session,
            holder_public_jwk=holder_jwk,
        )

        return {
            "credential": vc,
        }

    except CredentialIssuanceError as exc:
        return JSONResponse(
            status_code=400,
            content={
                "verdict": exc.verdict,
                "error_code": (
                    exc.detail.value
                    if exc.detail is not None
                    else None
                ),
            },
        )

    except Exception:
        logging.exception("unexpected runtime error")
        return JSONResponse(
            status_code=500,
            content={
                "verdict": "REJECT_INVALID_REQUEST",
                "error_code": "INVALID_REQUEST",
            },
        )
