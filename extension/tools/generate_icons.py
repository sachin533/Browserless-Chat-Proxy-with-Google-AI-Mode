"""Generate the extension icons.

The icons are produced programmatically so they can be regenerated at any
time and no binary blob has to be maintained by hand.

Usage::

    python extension/tools/generate_icons.py

Output: ``extension/icons/icon{16,32,48,128}.png``
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

BACKGROUND = (11, 15, 23, 255)      # #0b0f17
ACCENT = (59, 130, 246, 255)       # #3b82f6
ACCENT_SOFT = (96, 165, 250, 255)  # #60a5fa

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4


def rounded_rect(x: float, y: float, size: float, radius: float) -> bool:
    """Return True when the point is inside a rounded square."""
    if x < 0 or y < 0 or x > size or y > size:
        return False
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 or (
        radius <= x <= size - radius or radius <= y <= size - radius
    )


def triangle(x: float, y: float, size: float) -> bool:
    """Return True when the point is inside the send triangle."""
    left = size * 0.34
    right = size * 0.72
    top = size * 0.26
    bottom = size * 0.74
    if not (left <= x <= right and top <= y <= bottom):
        return False
    middle = (top + bottom) / 2
    if y <= middle:
        t = (y - top) / (middle - top)
    else:
        t = (bottom - y) / (bottom - middle)
    return x <= left + (right - left) * t


def render(size: int) -> bytes:
    """Render one icon and return the raw RGBA rows."""
    rows = []
    radius = size * 0.24
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = px + (sx + 0.5) / SUPERSAMPLE
                    y = py + (sy + 0.5) / SUPERSAMPLE
                    if not rounded_rect(x, y, size, radius):
                        continue
                    if triangle(x, y, size):
                        colour = ACCENT
                    elif size >= 32 and triangle(x + size * 0.09, y, size):
                        colour = ACCENT_SOFT
                    else:
                        colour = BACKGROUND
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
                    a += colour[3]
            samples = SUPERSAMPLE * SUPERSAMPLE
            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((r // samples, g // samples, b // samples, a // samples))
        rows.append(bytes(row))
    return b"".join(b"\x00" + row for row in rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    target = Path(__file__).resolve().parent.parent / "icons"
    target.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = target / f"icon{size}.png"
        write_png(path, size, render(size))
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
