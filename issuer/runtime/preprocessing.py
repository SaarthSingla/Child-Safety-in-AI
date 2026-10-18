"""Deterministic, fail-closed enrolment-selfie preprocessing.

CANONICAL production pipeline, frozen for childsafe-age-runtime-v1.1:

    raw image bytes
    -> decode RGB
    -> YOLO ONNX face detector
    -> NMS (IoU = detector_config.nms_iou)
    -> require exactly ONE significant primary face
    -> reject zero / multiple significant / tiny faces / junk
    -> 25% margin crop with INTEGER TRUNCATION of the margin coordinates
       (historical training-data behaviour -- NOT round())
    -> resize 224x224 with Image.Resampling.BICUBIC (explicit; the historical
       PIL resize() default for RGB was bicubic)
    -> float32 / 255
    -> ImageNet normalisation
    -> NCHW tensor

There is deliberately NO fallback to classifying the whole image when
detection fails -- that fallback exists only in the training data cleaner.
Failure is fail-closed: NO_FACE / MULTIPLE_FACES / BAD_IMAGE / FACE_TOO_SMALL.

Dependencies: numpy, pillow, onnxruntime. No torch, no ultralytics.
"""
from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from .errors import ErrorCode, PreprocessError

_BILINEAR = getattr(Image, "Resampling", Image).BILINEAR   # detector letterbox only
_BICUBIC = getattr(Image, "Resampling", Image).BICUBIC     # canonical model-input resize


def _sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


@dataclass(frozen=True)
class PreprocessConfig:
    """Frozen preprocessing / detector contract. Loaded from
    ``detector/detector_config.json`` in the release bundle."""

    detector_input_size: int = 448
    face_confidence: float = 0.25
    nms_iou: float = 0.70
    margin: float = 0.25
    model_input_size: int = 224
    # a non-primary face is "significant" when its area is at least this
    # fraction of the largest detected face's area
    multi_face_rel_area: float = 0.35
    # reject when the primary face's shorter side (original px) is below this
    min_face_px: int = 48
    normalization_mean: tuple = (0.485, 0.456, 0.406)
    normalization_std: tuple = (0.229, 0.224, 0.225)
    crop_rounding: str = "trunc"        # historical integer truncation, not round()
    model_resize_filter: str = "bicubic"

    @classmethod
    def from_json(cls, path) -> "PreprocessConfig":
        d = json.loads(Path(path).read_text())
        return cls(
            detector_input_size=int(d.get("detector_input_size", 448)),
            face_confidence=float(d.get("face_confidence", 0.25)),
            nms_iou=float(d.get("nms_iou", 0.70)),
            margin=float(d.get("margin", 0.25)),
            model_input_size=int(d.get("model_input_size", 224)),
            multi_face_rel_area=float(d.get("multi_face_rel_area", 0.35)),
            min_face_px=int(d.get("min_face_px", 48)),
            normalization_mean=tuple(d.get("normalization_mean", (0.485, 0.456, 0.406))),
            normalization_std=tuple(d.get("normalization_std", (0.229, 0.224, 0.225))),
            crop_rounding=str(d.get("crop_rounding", "trunc")),
            model_resize_filter=str(d.get("model_resize_filter", "bicubic")),
        )


def _letterbox(rgb: np.ndarray, size: int):
    """Resize keeping aspect ratio, pad to ``size`` x ``size`` with 114 grey
    (Ultralytics default). Returns (canvas, ratio, pad_left, pad_top)."""
    h, w = rgb.shape[:2]
    r = min(size / h, size / w)
    nh, nw = max(1, int(round(h * r))), max(1, int(round(w * r)))
    resized = np.asarray(Image.fromarray(rgb).resize((nw, nh), _BILINEAR))
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    top, left = (size - nh) // 2, (size - nw) // 2
    canvas[top:top + nh, left:left + nw] = resized
    return canvas, r, left, top


def nms_numpy(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list:
    """Greedy IoU NMS reproducing Ultralytics predict() behaviour. The
    notebook's ONNX parity test checks this against ultralytics directly."""
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1).clip(min=0) * (y2 - y1).clip(min=0)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        inter = (xx2 - xx1).clip(min=0) * (yy2 - yy1).clip(min=0)
        iou = inter / (areas[i] + areas[rest] - inter + 1e-9)
        order = rest[iou <= iou_thr]
    return keep


class FaceDetectorONNX:
    """YOLOv8-face ONNX session (exported WITHOUT embedded NMS). Box decode
    and NMS are done here so behaviour is pinned and testable."""

    def __init__(self, onnx_path, providers=None):
        self.onnx_path = str(onnx_path)
        self.session = ort.InferenceSession(
            self.onnx_path,
            providers=providers or ["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        self._input_name = self.session.get_inputs()[0].name

    def detect(self, rgb: np.ndarray, cfg: PreprocessConfig) -> np.ndarray:
        """Return (N, 5) array of [x1, y1, x2, y2, conf] in ORIGINAL pixels,
        highest confidence first."""
        size = cfg.detector_input_size
        canvas, r, pad_l, pad_t = _letterbox(rgb, size)
        blob = canvas.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
        raw = np.asarray(self.session.run(None, {self._input_name: blob})[0])
        if raw.ndim == 3:                       # (1, 4+nc, M) -> (M, 4+nc)
            raw = raw[0].transpose(1, 0)
        elif raw.ndim == 2 and raw.shape[0] < raw.shape[1]:
            raw = raw.transpose(1, 0)
        xywh = raw[:, :4]
        conf = raw[:, 4:].max(axis=1) if raw.shape[1] > 5 else raw[:, 4]
        m = conf >= cfg.face_confidence
        xywh, conf = xywh[m], conf[m]
        if len(xywh) == 0:
            return np.zeros((0, 5), dtype=np.float32)
        cx, cy, bw, bh = xywh.T
        xyxy = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
        xyxy[:, [0, 2]] -= pad_l
        xyxy[:, [1, 3]] -= pad_t
        xyxy /= r
        H, W = rgb.shape[:2]
        xyxy[:, [0, 2]] = xyxy[:, [0, 2]].clip(0, W)
        xyxy[:, [1, 3]] = xyxy[:, [1, 3]].clip(0, H)
        keep = nms_numpy(xyxy, conf, cfg.nms_iou)
        out = np.concatenate([xyxy[keep], conf[keep, None]], axis=1).astype(np.float32)
        return out[out[:, 4].argsort()[::-1]]


@dataclass
class RuntimePreprocessResult:
    """Internal only. None of these fields is ever returned by the external
    service or written to a log."""

    tensor: np.ndarray            # (1, 3, H, W) float32, ImageNet-normalised
    input_sha256: str
    crop_sha256: str
    tensor_sha256: str

    def __repr__(self) -> str:
        return "RuntimePreprocessResult(<redacted>)"


def preprocess_runtime(image_bytes: bytes,
                       detector: FaceDetectorONNX,
                       cfg: PreprocessConfig) -> RuntimePreprocessResult:
    """Fail-closed. Raises :class:`PreprocessError` with one of
    NO_FACE / MULTIPLE_FACES / BAD_IMAGE / FACE_TOO_SMALL on any problem."""
    if not isinstance(image_bytes, (bytes, bytearray)) or len(image_bytes) == 0:
        raise PreprocessError(ErrorCode.BAD_IMAGE, "empty input")
    raw_bytes = bytes(image_bytes)
    try:
        pil = Image.open(io.BytesIO(raw_bytes))
        pil.load()
        pil = pil.convert("RGB")
    except Exception:
        raise PreprocessError(ErrorCode.BAD_IMAGE, "undecodable") from None

    rgb = np.asarray(pil)
    if rgb.ndim != 3 or rgb.shape[2] != 3 or min(rgb.shape[:2]) < 16:
        raise PreprocessError(ErrorCode.BAD_IMAGE, "degenerate")

    dets = detector.detect(rgb, cfg)
    if len(dets) == 0:
        raise PreprocessError(ErrorCode.NO_FACE)

    areas = (dets[:, 2] - dets[:, 0]) * (dets[:, 3] - dets[:, 1])
    primary = int(areas.argmax())
    px1, py1, px2, py2 = (float(v) for v in dets[primary, :4])
    significant = int((areas >= cfg.multi_face_rel_area * float(areas[primary])).sum())
    if significant > 1:
        raise PreprocessError(ErrorCode.MULTIPLE_FACES)

    if min(px2 - px1, py2 - py1) < cfg.min_face_px:
        raise PreprocessError(ErrorCode.FACE_TOO_SMALL)

    mw, mh = (px2 - px1) * cfg.margin, (py2 - py1) * cfg.margin
    H, W = rgb.shape[:2]
    # canonical: integer TRUNCATION of the margin coordinates (historical), not round()
    box = (max(0, int(px1 - mw)), max(0, int(py1 - mh)),
           min(W, int(px2 + mw)), min(H, int(py2 + mh)))
    crop = pil.crop(box)

    crop_bytes = crop.tobytes()
    # canonical: explicit BICUBIC for the model-input resize
    resized = crop.resize((cfg.model_input_size, cfg.model_input_size), _BICUBIC)
    arr = np.asarray(resized).astype(np.float32) / 255.0
    mean = np.asarray(cfg.normalization_mean, dtype=np.float32)
    std = np.asarray(cfg.normalization_std, dtype=np.float32)
    arr = (arr - mean) / std
    tensor = np.ascontiguousarray(arr.transpose(2, 0, 1)[None].astype(np.float32))

    return RuntimePreprocessResult(
        tensor=tensor,
        input_sha256=_sha256(raw_bytes),
        crop_sha256=_sha256(crop_bytes),
        tensor_sha256=_sha256(tensor.tobytes()),
    )
