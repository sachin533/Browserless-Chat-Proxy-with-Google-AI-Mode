"""In-process token bucket rate limiter.

The limiter is intentionally simple: the backend is designed to run as a single
process next to a single browser session, so a shared store would add
complexity without buying anything.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class _Bucket:
    tokens: float
    updated_at: float = field(default_factory=time.monotonic)


class RateLimiter:
    """Sliding window rate limiter keyed by an arbitrary string."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = max(1, int(limit))
        self.window = max(0.1, float(window_seconds))
        self._buckets: dict[str, _Bucket] = {}

    def check(self, key: str) -> tuple[bool, int]:
        """Consume one slot for *key*.

        Returns ``(allowed, retry_after_seconds)``.
        """
        now = time.monotonic()
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = _Bucket(tokens=float(self.limit), updated_at=now)
            self._buckets[key] = bucket
        else:
            elapsed = now - bucket.updated_at
            if elapsed > 0:
                bucket.tokens = min(
                    float(self.limit), bucket.tokens + elapsed * (self.limit / self.window)
                )
                bucket.updated_at = now

        if bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            return True, 0

        deficit = 1.0 - bucket.tokens
        retry_after = int(deficit * (self.window / self.limit)) + 1
        return False, retry_after

    def reset(self) -> None:
        self._buckets.clear()

    def prune(self, max_age_seconds: float | None = None) -> None:
        """Drop buckets that have been idle for longer than the window."""
        max_age = max_age_seconds if max_age_seconds is not None else self.window * 2
        now = time.monotonic()
        stale = [
            key
            for key, bucket in self._buckets.items()
            if now - bucket.updated_at > max_age
        ]
        for key in stale:
            self._buckets.pop(key, None)
