"""CLIP ViT-B/16 age-band classifier + temperature calibration.

Loads a frozen ``safetensors`` state dict into a timm model. No training,
no gradient, float32, eval mode -> deterministic for a given input tensor
and device.

The result object is INTERNAL ONLY and has a redacted ``__repr__`` so it
cannot leak into a log line or a traceback.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import timm
import torch
from safetensors.torch import load_model

from .calibration import TemperatureScaler

BANDS = ["0_5", "6_11", "12_17", "18plus"]
MINOR_CLASSES = (0, 1, 2)
ADULT_CLASS = 3


@dataclass
class AgeEstimationResult:
    """Private. Never returned by the external service, never logged."""

    band: str
    confidence: float            # calibrated P(argmax band), UNROUNDED
    probabilities: np.ndarray    # calibrated 4-vector, internal use only

    def __repr__(self) -> str:
        return "AgeEstimationResult(<redacted>)"

    @property
    def predicted_index(self) -> int:
        return int(np.asarray(self.probabilities).argmax())

    @property
    def p_minor(self) -> float:
        """P(0_5) + P(6_11) + P(12_17). A MINOR-GATE quantity, not a
        prediction confidence -- see runtime.policy."""
        return float(np.asarray(self.probabilities)[list(MINOR_CLASSES)].sum())


class AgeBandEstimator:
    def __init__(self, model_config: dict, weights_path,
                 scaler: TemperatureScaler, device: "str | None" = None):
        self.bands = list(model_config["bands"])
        self.architecture = str(model_config["architecture"])
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = timm.create_model(
            self.architecture,
            pretrained=False,
            num_classes=int(model_config["num_classes"]),
            drop_path_rate=float(model_config.get("drop_path_rate", 0.0)),
        )
        # model-aware, STRICT: any missing/unexpected parameter aborts.
        res = load_model(self.model, str(weights_path), strict=True)
        missing, unexpected = res if isinstance(res, (tuple, list)) else ([], [])
        if missing or unexpected:
            raise RuntimeError(
                f"strict safetensors load mismatch: missing={list(missing)} "
                f"unexpected={list(unexpected)}")
        self.model.eval().to(self.device)
        for p in self.model.parameters():
            p.requires_grad_(False)
        self.scaler = scaler

    @torch.no_grad()
    def _logits(self, tensor_np: np.ndarray) -> np.ndarray:
        x = torch.from_numpy(np.ascontiguousarray(tensor_np)).float().to(self.device)
        return self.model(x).float().cpu().numpy()

    def estimate(self, tensor_np: np.ndarray) -> AgeEstimationResult:
        logits = self._logits(tensor_np)                 # (1, C)
        probs = self.scaler.apply(logits)[0]             # calibrated
        idx = int(probs.argmax())
        return AgeEstimationResult(
            band=self.bands[idx],
            confidence=float(probs[idx]),
            probabilities=np.asarray(probs, dtype=np.float64),
        )
