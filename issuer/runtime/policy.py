"""Issuance policy -- deliberately separate from the neural network.

The policy sees only an :class:`AgeEstimationResult`. It never touches
image bytes, tensors or logits. Every threshold is configuration-driven
(``policy/issuance_policy.json``) so it can be changed without retraining
or editing code.

Two different quantities, kept distinct on purpose:

* ``min_band_confidence`` -- a gate on the *calibrated probability of the
  predicted band*. This is the credential's ``prediction_confidence``.
* ``minor_gate_threshold`` -- a gate on ``P(minor) = P(0_5)+P(6_11)+P(12_17)``.
  This is the legacy MINOR-GATE decision. It is NOT a prediction confidence
  and is used only as an optional adult guard.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .errors import ErrorCode, Verdict
from .estimator import AgeEstimationResult

ADULT_BAND = "18plus"


@dataclass(frozen=True)
class PolicyDecision:
    verdict: Verdict
    age_band: "str | None" = None
    vc_confidence: "float | None" = None     # rounded, goes in the credential
    detail: "ErrorCode | None" = None


@dataclass(frozen=True)
class IssuancePolicyConfig:
    min_band_confidence: float = 0.60
    adult_policy_enabled: bool = True
    target_minor_recall: float = 0.98
    minor_gate_threshold: float = 0.50
    confidence_decimals: int = 2

    @classmethod
    def from_json(cls, path) -> "IssuancePolicyConfig":
        d = json.loads(Path(path).read_text())
        ap = d.get("adult_policy", {}) or {}
        return cls(
            min_band_confidence=float(d.get("min_band_confidence", 0.60)),
            adult_policy_enabled=bool(ap.get("enabled", True)),
            target_minor_recall=float(ap.get("target_minor_recall", 0.98)),
            minor_gate_threshold=float(ap.get("minor_gate_threshold", 0.50)),
            confidence_decimals=int(d.get("confidence_decimals", 2)),
        )

    def to_dict(self) -> dict:
        return {
            "min_band_confidence": self.min_band_confidence,
            "confidence_decimals": self.confidence_decimals,
            "adult_policy": {
                "enabled": self.adult_policy_enabled,
                "target_minor_recall": self.target_minor_recall,
                "minor_gate_threshold": self.minor_gate_threshold,
            },
        }


class IssuancePolicy:
    def __init__(self, config: IssuancePolicyConfig):
        self.config = config

    def minor_gate(self, result: AgeEstimationResult) -> bool:
        """True when P(minor) exceeds the MINOR-GATE threshold. This is not
        prediction confidence."""
        return result.p_minor > self.config.minor_gate_threshold

    def evaluate(self, result: AgeEstimationResult) -> PolicyDecision:
        cfg = self.config
        if float(result.confidence) < cfg.min_band_confidence:
            return PolicyDecision(Verdict.REJECT_LOW_CONFIDENCE,
                                  detail=ErrorCode.LOW_CONFIDENCE)
        # Optional adult guard: do not hand an 18plus credential to someone
        # the minor gate flags as a child.
        if (cfg.adult_policy_enabled and result.band == ADULT_BAND
                and self.minor_gate(result)):
            return PolicyDecision(Verdict.REJECT_LOW_CONFIDENCE,
                                  detail=ErrorCode.LOW_CONFIDENCE)
        vc_conf = round(float(result.confidence), cfg.confidence_decimals)
        return PolicyDecision(Verdict.ISSUE, age_band=result.band, vc_confidence=vc_conf)
