"""Local, repeatable tracing spike; outputs stay under ignored output/.

Usage: python scripts/vector-spike.py INPUT.png
This does not claim semantic segmentation or production-ready vectorization.
"""

from pathlib import Path
import json
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "output" / "vector-spike" / "vendor"
sys.path.insert(0, str(VENDOR))
import vtracer  # type: ignore[import-not-found]  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/vector-spike.py INPUT.png")
    source = Path(sys.argv[1]).resolve(strict=True)
    output = ROOT / "output" / "vector-spike"
    output.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as full:
        if full.size != (4766, 2690):
            raise SystemExit(f"Expected the 4766x2690 case image, got {full.size}")
        # The thin blue divider is a deliberately simple first target. The crop
        # coordinates are explicit so results can be inspected, not mistaken for
        # automatic object detection.
        crop = full.convert("RGB").crop((1900, 500, 4560, 555))
        crop.save(output / "divider-crop.png")
        # Contrast case: tracing visible lettering may create outlines, but
        # cannot recover the original editable text or fix hallucinated glyphs.
        full.convert("RGB").crop((270, 620, 1020, 910)).save(output / "lettering-crop.png")
    vtracer.convert_image_to_svg_py(
        str(output / "divider-crop.png"),
        str(output / "divider-raw.svg"),
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=8,
        color_precision=4,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4,
        max_iterations=10,
        splice_threshold=45,
        path_precision=3,
    )
    tree = ET.parse(output / "divider-raw.svg")
    ns = {"svg": "http://www.w3.org/2000/svg"}
    paths = tree.findall("svg:path", ns)
    nonwhite = [p for p in paths if p.get("fill", "").upper() != "#FFFFFF"]
    if len(nonwhite) != 1:
        raise SystemExit(f"Expected one foreground shape; got {len(nonwhite)}. Inspect raw SVG manually.")
    path = nonwhite[0]
    if not re.fullmatch(r"translate\([0-9.]+,[0-9.]+\)", path.get("transform", "")):
        raise SystemExit("Unexpected VTracer transform; do not silently flatten it.")
    # This specimen is exported in its own local coordinates. The crop and
    # original offset are recorded separately rather than silently discarded.
    cleaned = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2610 10">'
        f'<path d="{path.attrib["d"].strip()}" fill="{path.attrib["fill"]}"/>'
        '</svg>'
    )
    (output / "divider-importable.svg").write_text(cleaned, encoding="utf-8")
    (output / "divider-manifest.json").write_text(json.dumps({
        "source": str(source), "crop_px": [1900, 500, 4560, 555],
        "foreground_offset_within_crop_px": [30, 25],
        "foreground_size_px": [2610, 10], "paths": len(nonwhite),
        "warning": "Only a simple divider; visual candidate, not a measured production path."
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    vtracer.convert_image_to_svg_py(
        str(output / "lettering-crop.png"), str(output / "lettering-raw.svg"),
        colormode="color", hierarchical="stacked", mode="spline",
        filter_speckle=8, color_precision=4, layer_difference=16,
        corner_threshold=60, length_threshold=4, max_iterations=10,
        splice_threshold=45, path_precision=3,
    )
    lettering_paths = ET.parse(output / "lettering-raw.svg").findall("svg:path", ns)
    (output / "lettering-manifest.json").write_text(json.dumps({
        "crop_px": [270, 620, 1020, 910], "traced_paths": len(lettering_paths),
        "editable_text_objects": 0,
        "warning": "Outlined pixels are not restored text; exact copy must come from the client source."
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output / "divider-raw.svg")
    print(output / "divider-importable.svg")
    print(f"Lettering trace: {len(lettering_paths)} paths, zero editable text objects")


if __name__ == "__main__":
    main()
