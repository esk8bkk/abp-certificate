#!/usr/bin/env python3
"""Compare headless canvas renders against the design mockups and the spec."""

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPECS = json.loads((ROOT / "specs.json").read_text())
RENDER_DIR = Path(sys.argv[1])
MOCKUP_DIR = Path(sys.argv[2])

MOCKUPS = {
    "personal-portrait": MOCKUP_DIR / "mockup-personal-portrait.jpg",
    "personal-portrait-longname": MOCKUP_DIR / "mockup-personal-portrait-longname.jpg",
    "personal-story": MOCKUP_DIR / "mockup-personal-story.jpg",
    "group-landscape": MOCKUP_DIR / "mockup-group-landscape.jpg",
}

FRAMES = {frame["id"]: frame for frame in SPECS["frames"]}
CASES = {
    "personal-portrait": "personal-portrait",
    "personal-portrait-longname": "personal-portrait",
    "personal-story": "personal-story",
    "group-landscape": "group-landscape",
}


def is_purple(r, g, b):
    return r < 180 and b > r and b > 80 and g < 160


def is_magenta(r, g, b):
    return r > 120 and b > 70 and g < 110 and r > g + 40 and abs(r - b) < 110


def ink_box(image, box, predicate):
    x, y, w, h = box
    pixels = image.load()
    found = []
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            r, g, b = pixels[xx, yy][:3]
            if predicate(r, g, b):
                found.append((xx, yy))
    if not found:
        return None
    xs = [p[0] for p in found]
    ys = [p[1] for p in found]
    return (min(xs), min(ys), max(xs), max(ys), len(found))


def close(a, b, tol):
    return abs(a - b) <= tol


def main():
    errors = []
    notes = []
    for case, frame_id in CASES.items():
        frame = FRAMES[frame_id]
        render = Image.open(RENDER_DIR / f"{case}.png").convert("RGB")
        mock = Image.open(MOCKUPS[case]).convert("RGB")
        overlay = Image.open(ROOT / "assets" / "frames" / frame["file"]).convert("RGBA")
        if render.size != (frame["width"], frame["height"]):
            errors.append(f"{case}: size {render.size} != {(frame['width'], frame['height'])}")
        if mock.size != render.size:
            errors.append(f"{case}: mockup size {mock.size} != render {render.size}")

        # Overlay is drawn at 0,0. An opaque corner pixel must survive unchanged.
        if render.getpixel((10, 10)) != overlay.getpixel((10, 10))[:3]:
            errors.append(f"{case}: overlay is not placed at 0,0 (corner pixel changed)")

        for field in frame["fields"]:
            box = (field["x"], field["y"], field["width"], field["height"])
            pred = is_magenta if field["color"].lower() == "#b72d7c" else is_purple
            got = ink_box(render, box, pred)
            exp = ink_box(mock, box, pred)
            if got is None:
                errors.append(f"{case}.{field['id']}: no ink in field box")
                continue
            if exp is None:
                errors.append(f"{case}.{field['id']}: mockup detector found no ink")
                continue
            # Left edge tracks the pen at field.x; sidebearing keeps ink a few px to the right.
            if got[0] < field["x"] - 2:
                errors.append(f"{case}.{field['id']}: ink starts left of the field ({got[0]} < {field['x']})")
            if got[2] > field["x"] + field["width"] + 1:
                errors.append(f"{case}.{field['id']}: ink spills past the field width ({got[2]})")
            if got[1] < field["y"] - 1 or got[3] > field["y"] + field["height"] + 1:
                errors.append(f"{case}.{field['id']}: ink spills vertically {got[1:4]} box y={field['y']} h={field['height']}")
            # Latin/digit fields sit on the alphabetic baseline. Thai names extend below it.
            if field["id"] in {"date", "round", "seat", "gate", "classOf"}:
                if abs(got[3] - (field["baseline"] - 1)) > 3 and abs(got[3] - field["baseline"]) > 3:
                    errors.append(
                        f"{case}.{field['id']}: ink bottom {got[3]} is not on baseline {field['baseline']}"
                    )
            tol = 4
            deltas = [abs(got[i] - exp[i]) for i in range(4)]
            if any(d > tol for d in deltas):
                errors.append(
                    f"{case}.{field['id']}: bbox {got[:4]} != mockup {exp[:4]} (deltas {deltas}, tol {tol})"
                )
            else:
                notes.append(f"{case}.{field['id']}: bbox {got[:4]} mock {exp[:4]} deltas {deltas}")

        if case in {"personal-portrait", "personal-portrait-longname"}:
            name = next(field for field in frame["fields"] if field["id"] == "name")
            pixels = render.load()

            def row_count(y):
                return sum(
                    1
                    for x in range(name["x"], name["x"] + name["width"])
                    if is_purple(*pixels[x, y][:3])
                )

            body = row_count(name["baseline"] - 8)
            gap = row_count(name["baseline"] + 6)
            second = row_count(name["baseline"] + name["lineHeight"] - 8)
            notes.append(f"{case} name rows body={body} gap={gap} second={second}")
            if case == "personal-portrait-longname":
                if body < 40 or second < 40 or gap * 4 > body:
                    errors.append(f"{case}: expected two name lines with a gap (body={body} gap={gap} second={second})")
            elif second > 5:
                errors.append(f"{case}: short name drew a second line ({second} px)")

    photo = Image.open(RENDER_DIR / "personal-portrait.png").convert("RGB")
    zoomed = Image.open(RENDER_DIR / "personal-portrait-zoom.png").convert("RGB")
    # Sample photo: green center, red left stripe, blue body. Cover keeps the center,
    # the rounded corner stays on the overlay, and zooming reveals a different edge pixel.
    center = photo.getpixel((342, 528))
    inside = photo.getpixel((102, 258))
    corner = photo.getpixel((73, 229))
    edge = photo.getpixel((82, 528))
    edge_zoom = zoomed.getpixel((82, 528))
    notes.append(f"photo center {center} inside {inside} corner {corner} edge {edge} zoom-edge {edge_zoom}")
    if center != (0, 255, 136):
        errors.append(f"cover crop missed the photo center: {center}")
    if inside != (68, 102, 170):
        errors.append(f"photo window is not showing the sample photo: {inside}")
    if edge != (220, 30, 30):
        errors.append(f"cover placement missed the left stripe: {edge}")
    if edge_zoom == edge:
        errors.append(f"zoom did not change the photo crop: {edge_zoom}")
    overlay = Image.open(ROOT / "assets/frames/personal-portrait-1080x1350.png").convert("RGBA")
    if corner != overlay.getpixel((73, 229))[:3]:
        errors.append(f"rounded-rect clip failed at the window corner: {corner}")

    ui = Image.open(RENDER_DIR / "ui-export-longname-zoom.png").convert("RGB")
    harness = Image.open(RENDER_DIR / "personal-portrait-longname.png").convert("RGB")
    if ui.size != harness.size:
        errors.append(f"UI export size {ui.size} != harness {harness.size}")
    else:
        # Text and chrome sit below the photo window (ends y=828). They must match
        # the shared renderer even when the UI zoomed the photo.
        if ui.crop((0, 860, ui.width, ui.height)).tobytes() != harness.crop((0, 860, harness.width, harness.height)).tobytes():
            errors.append("UI export text band does not match the shared renderer")
        else:
            notes.append("UI export text band matches the shared renderer")

    print("\n".join(notes))
    if errors:
        print("FAIL")
        print("\n".join(errors))
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
