#!/usr/bin/env python3
"""Render the Done app icons.

No design tool required: one source of truth, four PNG sizes. Run from the
repo root with `python3 scripts/make-icons.py`.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
S = 1024  # supersampled master

GREEN_TOP = (86, 168, 120)
GREEN_BOTTOM = (34, 88, 62)
CREAM = (255, 249, 238)


def rounded_gradient(size: int, radius: int) -> Image.Image:
    gradient = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        gradient.putpixel(
            (0, y),
            tuple(round(a + (b - a) * t) for a, b in zip(GREEN_TOP, GREEN_BOTTOM)),
        )
    gradient = gradient.resize((size, size))

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)

    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile.paste(gradient, (0, 0), mask)
    return tile


def draw_icon(size: int) -> Image.Image:
    icon = rounded_gradient(S, radius=272)

    # Draw at master resolution, then downscale for clean edges.
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # A thick check, with round caps so it reads at 180 px.
    points = [(270, 540), (450, 720), (770, 350)]
    width = 92
    d.line(points, fill=CREAM, width=width, joint="curve")
    for x, y in points:
        r = width // 2
        d.ellipse((x - r, y - r, x + r, y + r), fill=CREAM)

    icon.alpha_composite(layer)
    return icon.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = draw_icon(S)
    for size in (512, 192, 180):
        master.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
    master.save(OUT / "icon-1024.png", optimize=True)
    print("wrote", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
