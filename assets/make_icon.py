#!/usr/bin/env python3
"""Generate the Kausap app icon (original artwork — not Meta's Messenger logo).

Produces a 1024x1024 master PNG: a rounded-square app tile with an indigo->violet
gradient and a white speech bubble containing three "typing" dots.

Run:  python3 assets/make_icon.py
Outputs: assets/icon.png (1024), assets/icon_512.png, assets/icon.ico
The .icns is built separately by build_icns.sh (macOS iconutil).
"""
from PIL import Image, ImageDraw

SIZE = 1024
RADIUS = 230  # rounded-square corner radius (iOS/macOS-ish "squircle" feel)


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def gradient(size, top, bottom):
    grad = Image.new("RGB", (size, size), top)
    d = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        d.line([(0, y), (size, y)], fill=(r, g, b))
    return grad


def make_master():
    # Indigo -> violet gradient (distinct from Messenger's blue/purple).
    base = gradient(SIZE, (94, 53, 217), (164, 64, 214))
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    img.paste(base, (0, 0), rounded_mask(SIZE, RADIUS))

    d = ImageDraw.Draw(img)

    # Speech bubble: a rounded rectangle body with a tail in the lower-left.
    bx0, by0, bx1, by1 = 230, 250, 794, 660
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=150, fill=(255, 255, 255, 255))
    # Tail (triangle pointing down-left).
    d.polygon([(360, 640), (360, 800), (500, 640)], fill=(255, 255, 255, 255))

    # Three "typing" dots inside the bubble.
    cy = (by0 + by1) // 2
    dot_r = 48
    for cx in (400, 512, 624):
        d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r],
                  fill=(124, 58, 217, 255))

    return img


def main():
    master = make_master()
    master.save("assets/icon.png")
    master.resize((512, 512), Image.LANCZOS).save("assets/icon_512.png")
    # Multi-resolution .ico for Windows.
    master.save("assets/icon.ico", sizes=[(256, 256), (128, 128), (64, 64),
                                          (48, 48), (32, 32), (16, 16)])
    print("Wrote assets/icon.png, icon_512.png, icon.ico")


if __name__ == "__main__":
    main()
