"""Trim transparent margins around a Manim still without altering its artwork."""
import argparse
from pathlib import Path

from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--margin", type=int, default=32)
    args = parser.parse_args()
    image = Image.open(args.source).convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise SystemExit("Manim output is fully transparent")
    left, top, right, bottom = bounds
    m = args.margin
    bounds = (max(0, left - m), max(0, top - m), min(image.width, right + m), min(image.height, bottom + m))
    cropped = image.crop(bounds)
    if cropped.getpixel((0, 0))[3] != 0:
        raise SystemExit("Expected a transparent corner after trimming")
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(args.destination, optimize=True)
    print(f"Saved transparent {cropped.width}x{cropped.height} PNG to {args.destination}")


if __name__ == "__main__":
    main()
