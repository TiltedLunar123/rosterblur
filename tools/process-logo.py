# Turns a generated logo image into the shipped icon set.
#
#   python tools/process-logo.py <source.png>
#
# Steps: find the tile inside any dark margin, crop into it so the tile
# fills the frame, square-crop, resize to 16/32/48/128, apply a rounded
# corner mask, and write metadata-free PNGs into icons/.

import sys
import os
from PIL import Image, ImageDraw, ImageOps

SIZES = [16, 32, 48, 128]
CORNER_RADIUS_RATIO = 0.22
BG_THRESHOLD = 16  # channel value treated as "background black"


def tile_bbox(im):
    gray = ImageOps.grayscale(im)
    mask = gray.point(lambda v: 255 if v > BG_THRESHOLD else 0)
    box = mask.getbbox()
    return box if box else (0, 0, im.width, im.height)


def rounded(im, radius):
    mask = Image.new("L", im.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=radius, fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def main():
    if len(sys.argv) < 2:
        print("usage: python tools/process-logo.py <source.png>")
        sys.exit(1)
    src_path = sys.argv[1]
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(repo, "icons")
    os.makedirs(out_dir, exist_ok=True)

    im = Image.open(src_path).convert("RGBA")

    # Crop to the visible tile, then push inside its soft glow edge.
    left, top, right, bottom = tile_bbox(im)
    w, h = right - left, bottom - top
    inset = int(min(w, h) * 0.035)
    im = im.crop((left + inset, top + inset, right - inset, bottom - inset))

    # Square center crop.
    side = min(im.width, im.height)
    cx, cy = im.width // 2, im.height // 2
    im = im.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))

    for size in SIZES:
        icon = im.resize((size, size), Image.LANCZOS)
        icon = rounded(icon, max(2, int(size * CORNER_RADIUS_RATIO)))
        # Fresh image drops every source metadata chunk (EXIF, text,
        # color profile); nothing from the generator survives.
        clean = Image.new("RGBA", icon.size, (0, 0, 0, 0))
        clean.paste(icon, (0, 0))
        clean.info = {}
        path = os.path.join(out_dir, "icon%d.png" % size)
        clean.save(path, format="PNG", optimize=True)
        print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))


if __name__ == "__main__":
    main()
