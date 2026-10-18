"""Scalar temperature scaling (Guo et al., 2017, "On Calibration of Modern
Neural Networks").

The temperature is *fit* in the training notebook on the validation split
and frozen into ``policy/calibration.json``. This module only *applies* it,
so the confidential runtime never needs the validation set or an optimiser.

A raw softmax probability is not a calibrated confidence. Every consumer of
``prediction_confidence`` in this system must go through this scaler.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


def softmax(z: np.ndarray) -> np.ndarray:
    z = np.asarray(z, dtype=np.float64)
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


@dataclass(frozen=True)
class TemperatureScaler:
    """Immutable, dependency-light. ``apply`` maps logits -> calibrated probs."""

    temperature: float
    method: str = "temperature_scaling"
    fit_split: str = "validation"

    def __post_init__(self) -> None:
        if not (float(self.temperature) > 0.0):
            raise ValueError("temperature must be > 0")

    def apply(self, logits: np.ndarray) -> np.ndarray:
        """logits: (..., C) -> calibrated probabilities of the same shape."""
        return softmax(np.asarray(logits, dtype=np.float64) / float(self.temperature))

    def to_dict(self) -> dict:
        return {
            "method": self.method,
            "temperature": float(self.temperature),
            "fit_split": self.fit_split,
        }

    @classmethod
    def from_json(cls, path) -> "TemperatureScaler":
        d = json.loads(Path(path).read_text())
        return cls(
            temperature=float(d["temperature"]),
            method=str(d.get("method", "temperature_scaling")),
            fit_split=str(d.get("fit_split", "validation")),
        )


# --- calibration diagnostics (used by the notebook; kept here so the same
#     definitions travel with the release and can be re-checked later) -------

def nll(probs: np.ndarray, labels: np.ndarray, eps: float = 1e-12) -> float:
    probs = np.asarray(probs, dtype=np.float64)
    labels = np.asarray(labels, dtype=np.int64)
    p = np.clip(probs[np.arange(len(labels)), labels], eps, 1.0)
    return float(-np.log(p).mean())


def brier(probs: np.ndarray, labels: np.ndarray) -> float:
    probs = np.asarray(probs, dtype=np.float64)
    labels = np.asarray(labels, dtype=np.int64)
    onehot = np.zeros_like(probs)
    onehot[np.arange(len(labels)), labels] = 1.0
    return float(((probs - onehot) ** 2).sum(axis=1).mean())


def expected_calibration_error(probs: np.ndarray, labels: np.ndarray,
                               n_bins: int = 15) -> float:
    probs = np.asarray(probs, dtype=np.float64)
    labels = np.asarray(labels, dtype=np.int64)
    conf = probs.max(axis=1)
    pred = probs.argmax(axis=1)
    correct = (pred == labels).astype(np.float64)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n = len(labels)
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if not m.any():
            continue
        ece += m.mean() * abs(correct[m].mean() - conf[m].mean())
    return float(ece)


def reliability_bins(probs: np.ndarray, labels: np.ndarray, n_bins: int = 15):
    """Returns (bin_centers, bin_accuracy, bin_confidence, bin_weight)."""
    probs = np.asarray(probs, dtype=np.float64)
    labels = np.asarray(labels, dtype=np.int64)
    conf = probs.max(axis=1)
    correct = (probs.argmax(axis=1) == labels).astype(np.float64)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    centers, acc, cbar, wt = [], [], [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        centers.append((lo + hi) / 2.0)
        if m.any():
            acc.append(float(correct[m].mean()))
            cbar.append(float(conf[m].mean()))
            wt.append(float(m.mean()))
        else:
            acc.append(np.nan)
            cbar.append(np.nan)
            wt.append(0.0)
    return (np.array(centers), np.array(acc), np.array(cbar), np.array(wt))
