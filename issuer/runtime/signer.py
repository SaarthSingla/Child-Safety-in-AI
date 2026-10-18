"""Issuer signing abstraction.

The rest of the runtime depends only on the :class:`IssuerSigner` Protocol
(``kid`` + ``sign``). The concrete backend is injected. For Kaggle / CI it
is :class:`DevES256Signer` (an ephemeral P-256 key). In the Azure
confidential runtime it becomes a Key Vault / managed-HSM signer released
only to an attested VM -- swapped in without touching ML or credential code.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from openvc.keys import P256SigningKey


@runtime_checkable
class IssuerSigner(Protocol):
    @property
    def kid(self) -> str: ...

    def sign(self, signing_input: bytes) -> bytes: ...


_DEV_KEY_BANNER = (
    "============================================================\n"
    " DEVELOPMENT ONLY -- ephemeral P-256 issuer key.\n"
    " NEVER DEPLOY THIS PRIVATE KEY.\n"
    " The production IssuerSigner is the Azure confidential-runtime\n"
    " / Key Vault-backed signer and is injected with no change to\n"
    " the ML pipeline or credential construction.\n"
    "============================================================"
)


class DevES256Signer:
    """Ephemeral ES256 issuer signer. Wraps openvc's ``P256SigningKey`` so
    it doubles as an openvc ``SigningKey`` for the encoder while satisfying
    the :class:`IssuerSigner` Protocol for everything else.

    The private key lives only in memory and is never serialised into the
    release bundle. Only :meth:`public_jwk` is exported.
    """

    alg = "ES256"

    def __init__(self, kid: str = "https://issuer.childsafe.demo#dev-es256"):
        self._kid = str(kid)
        self._key = P256SigningKey.generate(kid=self._kid)

    @property
    def kid(self) -> str:
        return self._kid

    def sign(self, signing_input: bytes) -> bytes:
        return self._key.sign(signing_input)

    def public_jwk(self) -> dict:
        return self._key.public_jwk()

    @staticmethod
    def banner() -> str:
        return _DEV_KEY_BANNER


class AzureKeyVaultSigner:
    """Placeholder for the production signer.

    # Implemented during Azure confidential-runtime integration.
    Backed by Secure Key Release + a Key Vault / managed-HSM key that is
    released only to an attested confidential GPU VM. The signing input and
    ``kid`` contract are identical to :class:`DevES256Signer`.
    """

    def __init__(self, *_args, **_kwargs):
        raise NotImplementedError(
            "AzureKeyVaultSigner is implemented during Azure confidential-runtime "
            "integration.")
