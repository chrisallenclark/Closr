"""Sign in with Apple: verify the identity token the iOS app receives from Apple.

The app asks Apple to sign the user in with a random nonce (it sends Apple the nonce's SHA-256 and
keeps the raw value). Apple returns a signed JWT; the app sends it here with the raw nonce. The
token is accepted only if Apple signed it (keys from Apple's JWKS), it was issued for this app's
bundle id, it hasn't expired, and its nonce matches, so a stolen token can't be replayed.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"

_jwks = None


class AuthError(Exception):
    pass


@dataclass
class AppleIdentity:
    sub: str  # stable per user and Apple developer team
    email: str | None


def _keys():
    global _jwks
    if _jwks is None:
        from jwt import PyJWKClient

        _jwks = PyJWKClient(APPLE_KEYS_URL, cache_keys=True, lifespan=86400)
    return _jwks


def verify_apple_token(identity_token: str, raw_nonce: str, audiences: tuple[str, ...], keys=None) -> AppleIdentity:
    import jwt

    try:
        key = (keys or _keys()).get_signing_key_from_jwt(identity_token).key
        claims = jwt.decode(identity_token, key, algorithms=["RS256"], audience=list(audiences), issuer=APPLE_ISSUER,
                            options={"require": ["exp", "iat", "sub", "aud", "iss"]})
    except Exception as err:
        raise AuthError("Apple sign-in could not be verified") from err
    expected = hashlib.sha256(raw_nonce.encode()).hexdigest()
    if not raw_nonce or not hmac.compare_digest(str(claims.get("nonce", "")), expected):
        raise AuthError("Apple sign-in could not be verified")
    return AppleIdentity(sub=str(claims["sub"]), email=claims.get("email"))
