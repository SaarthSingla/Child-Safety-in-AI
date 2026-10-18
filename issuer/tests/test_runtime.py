"""Runtime-package unit tests. No biometric fixtures: the positive
face-detection path is exercised in the training notebook and, in CI, only
if ``CHILDSAFE_TEST_IMAGE`` points at a local face image.

Run:  pytest tests/test_runtime.py
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

BUNDLE = Path(__file__).resolve().parents[1]

from runtime.calibration import (TemperatureScaler, brier,
                                 expected_calibration_error, nll, softmax)
from runtime.errors import ErrorCode, PreprocessError, Verdict
from runtime.estimator import AgeEstimationResult
from runtime.policy import IssuancePolicy, IssuancePolicyConfig
from runtime.preprocessing import PreprocessConfig, nms_numpy, preprocess_runtime
from runtime.service import RuntimeLogger
from runtime.session import InMemorySessionValidator, IssuanceSession


def _blank_jpeg(size=(384, 384), colour=(127, 127, 127)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


# --------------------------------------------------------------------------
# calibration
# --------------------------------------------------------------------------
def test_temperature_scaler_rejects_non_positive():
    with pytest.raises(ValueError):
        TemperatureScaler(temperature=0.0)
    with pytest.raises(ValueError):
        TemperatureScaler(temperature=-1.0)


def test_temperature_identity_is_plain_softmax():
    z = np.array([[2.0, 0.5, -1.0, 0.3]])
    np.testing.assert_allclose(TemperatureScaler(1.0).apply(z), softmax(z), rtol=1e-9)


def test_temperature_gt_one_reduces_confidence():
    z = np.array([[4.0, 1.0, 0.0, -2.0]])
    sharp = TemperatureScaler(1.0).apply(z).max()
    soft = TemperatureScaler(2.5).apply(z).max()
    assert soft < sharp


def test_calibration_metrics_finite():
    rng = np.random.default_rng(0)
    logits = rng.normal(size=(200, 4))
    labels = rng.integers(0, 4, size=200)
    p = softmax(logits)
    assert np.isfinite(nll(p, labels))
    assert 0.0 <= brier(p, labels) <= 2.0
    assert 0.0 <= expected_calibration_error(p, labels) <= 1.0


def test_calibration_json_roundtrip(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"method": "temperature_scaling",
                             "temperature": 1.7, "fit_split": "validation"}))
    s = TemperatureScaler.from_json(p)
    assert s.temperature == 1.7 and s.fit_split == "validation"


# --------------------------------------------------------------------------
# preprocessing -- fail closed
# --------------------------------------------------------------------------
def test_preprocess_rejects_non_bytes():
    with pytest.raises(PreprocessError) as e:
        preprocess_runtime("not-bytes", detector=None, cfg=PreprocessConfig())
    assert e.value.code == ErrorCode.BAD_IMAGE


def test_preprocess_rejects_empty():
    with pytest.raises(PreprocessError) as e:
        preprocess_runtime(b"", detector=None, cfg=PreprocessConfig())
    assert e.value.code == ErrorCode.BAD_IMAGE


def test_preprocess_rejects_junk_bytes():
    with pytest.raises(PreprocessError) as e:
        preprocess_runtime(b"\x00\x01not-a-jpeg\xff", detector=None, cfg=PreprocessConfig())
    assert e.value.code == ErrorCode.BAD_IMAGE


class _NoFaceDetector:
    def detect(self, rgb, cfg):
        return np.zeros((0, 5), dtype=np.float32)


class _FixedDetector:
    def __init__(self, boxes):
        self._boxes = np.asarray(boxes, dtype=np.float32)

    def detect(self, rgb, cfg):
        return self._boxes


def test_preprocess_no_face():
    with pytest.raises(PreprocessError) as e:
        preprocess_runtime(_blank_jpeg(), detector=_NoFaceDetector(), cfg=PreprocessConfig())
    assert e.value.code == ErrorCode.NO_FACE


def test_preprocess_multiple_faces():
    det = _FixedDetector([[10, 10, 130, 130, 0.9], [200, 200, 320, 320, 0.85]])
    with pytest.raises(PreprocessError) as e:
        preprocess_runtime(_blank_jpeg((384, 384)), detector=det, cfg=PreprocessConfig())
    assert e.value.code == ErrorCode.MULTIPLE_FACES


def test_preprocess_face_too_small():
    det = _FixedDetector([[10, 10, 30, 30, 0.9]])
    with pytest.raises(PreprocessError) as e:
        preprocess_runtime(_blank_jpeg((384, 384)), detector=det,
                           cfg=PreprocessConfig(min_face_px=48))
    assert e.value.code == ErrorCode.FACE_TOO_SMALL


def test_preprocess_single_face_shapes_and_hashes():
    det = _FixedDetector([[40, 40, 300, 300, 0.95]])
    res = preprocess_runtime(_blank_jpeg((384, 384)), detector=det, cfg=PreprocessConfig())
    assert res.tensor.shape == (1, 3, 224, 224)
    assert res.tensor.dtype == np.float32
    for h in (res.input_sha256, res.crop_sha256, res.tensor_sha256):
        assert isinstance(h, str) and len(h) == 64
    assert repr(res) == "RuntimePreprocessResult(<redacted>)"


def test_nms_suppresses_overlap():
    boxes = np.array([[0, 0, 100, 100], [5, 5, 104, 104], [400, 400, 460, 460]], float)
    scores = np.array([0.9, 0.8, 0.7])
    keep = nms_numpy(boxes, scores, 0.5)
    assert 0 in keep and 2 in keep and 1 not in keep


# --------------------------------------------------------------------------
# policy -- separate from the network
# --------------------------------------------------------------------------
def _result(probs, band=None):
    probs = np.asarray(probs, dtype=np.float64)
    bands = ["0_5", "6_11", "12_17", "18plus"]
    idx = int(probs.argmax())
    return AgeEstimationResult(band=band or bands[idx],
                               confidence=float(probs[idx]), probabilities=probs)


def test_policy_issues_when_confident():
    d = IssuancePolicy(IssuancePolicyConfig(min_band_confidence=0.60)).evaluate(
        _result([0.02, 0.03, 0.15, 0.80]))
    assert d.verdict == Verdict.ISSUE
    assert d.age_band == "18plus"
    assert d.vc_confidence == 0.8


def test_policy_rejects_low_confidence():
    d = IssuancePolicy(IssuancePolicyConfig(min_band_confidence=0.60)).evaluate(
        _result([0.3, 0.3, 0.25, 0.15]))
    assert d.verdict == Verdict.REJECT_LOW_CONFIDENCE
    assert d.detail == ErrorCode.LOW_CONFIDENCE


def test_policy_adult_guard_uses_minor_gate_not_confidence():
    # predicted 18plus with high band confidence, but P(minor) high -> guarded
    cfg = IssuancePolicyConfig(min_band_confidence=0.60, adult_policy_enabled=True,
                               minor_gate_threshold=0.50)
    r = AgeEstimationResult(band="18plus", confidence=0.66,
                            probabilities=np.array([0.1, 0.4, 0.24, 0.26]))
    d = IssuancePolicy(cfg).evaluate(r)
    assert d.verdict == Verdict.REJECT_LOW_CONFIDENCE


def test_policy_confidence_rounding():
    d = IssuancePolicy(IssuancePolicyConfig(min_band_confidence=0.5)).evaluate(
        _result([0.011, 0.019, 0.06, 0.910]))
    assert d.vc_confidence == 0.91


# --------------------------------------------------------------------------
# session validator
# --------------------------------------------------------------------------
def _session(sid="s1", nonce="n1", thumb="TP", ttl=3600, now=1_000):
    return IssuanceSession(sid, nonce, thumb, now, now + ttl)


class _StubThumb:
    """Monkeypatch target so we do not need a real key here."""


def test_session_unknown(monkeypatch):
    import runtime.session as svc
    monkeypatch.setattr(svc, "jwk_thumbprint", lambda _j: "TP")
    v = InMemorySessionValidator(now_fn=lambda: 1_000)
    with pytest.raises(Exception) as e:
        v.validate(_session(), {"kty": "EC"})
    assert e.value.code == ErrorCode.SESSION_UNKNOWN


def test_session_expired(monkeypatch):
    import runtime.session as svc
    monkeypatch.setattr(svc, "jwk_thumbprint", lambda _j: "TP")
    v = InMemorySessionValidator(now_fn=lambda: 10_000)
    s = _session(ttl=10, now=1_000)
    v.register(s)
    with pytest.raises(Exception) as e:
        v.validate(s, {"kty": "EC"})
    assert e.value.code == ErrorCode.SESSION_EXPIRED


def test_session_holder_mismatch(monkeypatch):
    import runtime.session as svc
    monkeypatch.setattr(svc, "jwk_thumbprint", lambda _j: "OTHER")
    v = InMemorySessionValidator(now_fn=lambda: 1_000)
    s = _session(thumb="TP")
    v.register(s)
    with pytest.raises(Exception) as e:
        v.validate(s, {"kty": "EC"})
    assert e.value.code == ErrorCode.HOLDER_KEY_MISMATCH


def test_session_validate_does_not_consume(monkeypatch):
    import runtime.session as svc
    monkeypatch.setattr(svc, "jwk_thumbprint", lambda _j: "TP")
    v = InMemorySessionValidator(now_fn=lambda: 1_000)
    s = _session()
    v.register(s)
    v.validate(s, {"kty": "EC"})
    v.validate(s, {"kty": "EC"})          # validate() has no side effect
    v.consume(s)                          # one-time
    with pytest.raises(Exception) as e:
        v.consume(s)
    assert e.value.code == ErrorCode.SESSION_REPLAY
    with pytest.raises(Exception) as e:
        v.validate(s, {"kty": "EC"})      # after consume, validate rejects as replay
    assert e.value.code == ErrorCode.SESSION_REPLAY


def test_session_consume_unknown():
    v = InMemorySessionValidator(now_fn=lambda: 1_000)
    with pytest.raises(Exception) as e:
        v.consume(_session(sid="never-registered"))
    assert e.value.code == ErrorCode.SESSION_UNKNOWN


# --------------------------------------------------------------------------
# logger redaction
# --------------------------------------------------------------------------
def test_logger_suppresses_unknown_events(caplog):
    lg = RuntimeLogger()
    with caplog.at_level("INFO"):
        lg.event("dump_tensor", "abcd1234")
        lg.event("credential_issued", "abcd1234")
    text = "\n".join(r.message for r in caplog.records)
    assert "event_suppressed" in text
    assert "dump_tensor" not in text


# --------------------------------------------------------------------------
# optional real-image smoke test
# --------------------------------------------------------------------------
@pytest.mark.skipif(not os.environ.get("CHILDSAFE_TEST_IMAGE"),
                    reason="set CHILDSAFE_TEST_IMAGE to a local face image")
def test_preprocess_real_image_end_to_end():
    from runtime.preprocessing import FaceDetectorONNX
    cfg = PreprocessConfig.from_json(BUNDLE / "detector" / "detector_config.json")
    det = FaceDetectorONNX(BUNDLE / "detector" / "face_detector.onnx")
    img = Path(os.environ["CHILDSAFE_TEST_IMAGE"]).read_bytes()
    res = preprocess_runtime(img, det, cfg)
    assert res.tensor.shape == (1, 3, cfg.model_input_size, cfg.model_input_size)
