#!/usr/bin/env python3
"""Finds the demo issuer's current public key and pins it in both apps.

The demo issuer makes a new signing key every time it starts and doesn't
publish it, so after a restart the wallet and Footube reject its
credentials. This script asks the issuer for two credentials (using a test
photo and a throwaway holder key), recovers the public key from their ES256
signatures, and checks that the key verifies both signatures. With --write
it puts the key into:

  wallet/src/crypto/sdJwt.ts          (TRUSTED_ISSUER_JWK)
  platform/src/verifier/config.ts     (trustedIssuerJwk)

The issuer itself is not changed. After --write, rebuild both apps.

  python3 tools/sync-issuer-key.py https://<issuer> path/to/face.jpg [--write]
  python3 tools/sync-issuer-key.py --self-test

Needs the `cryptography` package.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [ROOT / "wallet/src/crypto/sdJwt.ts", ROOT / "platform/src/verifier/config.ts"]

# P-256 domain parameters.
P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
     0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


# -- elliptic-curve arithmetic (affine; None is the point at infinity) --------
def add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if p1 == p2:
        lam = (3 * x1 * x1 + A) * pow(2 * y1, -1, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return x3, (lam * (x1 - x3) - y1) % P


def mul(k: int, point):
    result = None
    while k:
        if k & 1:
            result = add(result, point)
        point = add(point, point)
        k >>= 1
    return result


def recover_candidates(jws: str):
    """Public keys that could have produced this ES256 compact JWS."""
    header, payload, sig = jws.split(".")
    raw = b64d(sig)
    r, s = int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")
    e = int.from_bytes(hashlib.sha256(f"{header}.{payload}".encode()).digest(), "big")
    out = set()
    for x in (r, r + N):
        if x >= P:
            continue
        alpha = (x * x * x + A * x + B) % P
        beta = pow(alpha, (P + 1) // 4, P)  # P = 3 mod 4
        if beta * beta % P != alpha:
            continue
        for y in (beta, P - beta):
            q = mul(pow(r, -1, N), add(mul(s, (x, y)), mul((N - e) % N, G)))
            if q is not None:
                out.add(q)
    return out


def verifies(jws: str, q) -> bool:
    header, payload, sig = jws.split(".")
    raw = b64d(sig)
    key = ec.EllipticCurvePublicNumbers(q[0], q[1], ec.SECP256R1()).public_key()
    try:
        key.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
                   f"{header}.{payload}".encode(), ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


def recover_key(jws_list):
    candidates = recover_candidates(jws_list[0])
    for jws in jws_list[1:]:
        candidates &= recover_candidates(jws)
    candidates = {q for q in candidates if all(verifies(j, q) for j in jws_list)}
    if len(candidates) != 1:
        raise SystemExit(f"could not pin down a single key ({len(candidates)} candidates); were both credentials from the same issuer run?")
    (x, y), = candidates
    return {"kty": "EC", "crv": "P-256", "x": b64e(x.to_bytes(32, "big")), "y": b64e(y.to_bytes(32, "big"))}


# -- talking to the issuer ---------------------------------------------------
def post_form(url: str, fields: dict, image: Path | None = None) -> dict:
    boundary = f"----chaise{uuid.uuid4().hex}"
    body = bytearray()
    for name, value in fields.items():
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    if image:
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{image.name}"\r\n'
                 "Content-Type: image/jpeg\r\n\r\n").encode() + image.read_bytes() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(url, data=bytes(body), method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        raise SystemExit(f"{url}: HTTP {err.code}: {err.read().decode(errors='replace')[:400]}")


def issue_one(issuer: str, image: Path) -> str:
    holder = ec.generate_private_key(ec.SECP256R1()).public_key().public_numbers()
    jwk = json.dumps({"kty": "EC", "crv": "P-256", "x": b64e(holder.x.to_bytes(32, "big")), "y": b64e(holder.y.to_bytes(32, "big"))}, separators=(",", ":"))
    session = post_form(f"{issuer}/issuance/start", {"holder_public_jwk": jwk})
    result = post_form(f"{issuer}/issue", {
        "session_id": session["session_id"], "nonce": session["nonce"],
        "issued_at": str(session["issued_at"]), "expires_at": str(session["expires_at"]),
        "holder_public_jwk": jwk, "holder_key_thumbprint": session["holder_key_thumbprint"],
    }, image)
    if "credential" not in result:
        raise SystemExit(f"the issuer did not issue a credential: {json.dumps(result)[:400]}")
    return result["credential"].split("~")[0]


# -- pinning ------------------------------------------------------------------
JWK_BLOCK = re.compile(r"(kty: 'EC',\s*crv: 'P-256',\s*x: ')[^']+(',\s*y: ')[^']+(')")


def pin(jwk: dict, write: bool) -> None:
    for path in TARGETS:
        text = path.read_text()
        matches = JWK_BLOCK.findall(text)
        if len(matches) != 1:
            raise SystemExit(f"{path}: expected exactly one pinned P-256 key, found {len(matches)}")
        updated = JWK_BLOCK.sub(lambda m: f"{m.group(1)}{jwk['x']}{m.group(2)}{jwk['y']}{m.group(3)}", text)
        rel = path.relative_to(ROOT)
        if updated == text:
            print(f"  {rel}: already pinned")
        elif write:
            path.write_text(updated)
            print(f"  {rel}: updated")
        else:
            print(f"  {rel}: would update (run again with --write)")


def self_test() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    jws_list = []
    header = b64e(b'{"alg":"ES256"}')
    for i in range(2):
        signing_input = f"{header}.{b64e(json.dumps({'n': i}).encode())}"
        r, s = decode_dss_signature(key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256())))
        jws_list.append(f"{signing_input}.{b64e(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}")
    nums = key.public_key().public_numbers()
    expected = {"kty": "EC", "crv": "P-256", "x": b64e(nums.x.to_bytes(32, "big")), "y": b64e(nums.y.to_bytes(32, "big"))}
    assert recover_key(jws_list) == expected
    print("self-test passed: recovered the signing key from two signatures")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("issuer", nargs="?", help="issuer base URL, e.g. https://xyz.trycloudflare.com")
    parser.add_argument("image", nargs="?", type=Path, help="a face photo the issuer accepts (JPEG)")
    parser.add_argument("--write", action="store_true", help="update the two app files")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if not args.issuer or not args.image:
        parser.error("issuer URL and image are required")

    issuer = args.issuer.rstrip("/")
    print(f"Requesting two credentials from {issuer} …")
    jws_list = [issue_one(issuer, args.image) for _ in range(2)]
    header = json.loads(b64d(jws_list[0].split(".")[0]))
    jwk = recover_key(jws_list)
    print(f"Issuer key (kid {header.get('kid')}):\n  {json.dumps(jwk)}")
    pin(jwk, args.write)
    if args.write:
        print("Rebuild both apps so they trust the new key.")


if __name__ == "__main__":
    sys.exit(main())
