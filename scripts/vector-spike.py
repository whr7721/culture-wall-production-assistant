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
import cv2
import numpy as np

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
        # Extract only the dominant dark-blue connected silhouette. The white
        # letter holes are filled by using its external contour; this is a
        # color-constrained aid, not a general semantic segmentation model.
        panel_box = (115, 300, 1840, 2310)
        panel_rgb = np.asarray(full.convert("RGB").crop(panel_box))
        panel_mask = cv2.inRange(panel_rgb, (15, 45, 70), (45, 85, 130))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(panel_mask)
        if count < 2:
            raise SystemExit("No connected panel found; inspect color threshold")
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        dominant = np.uint8(labels == largest) * 255
        contours, _ = cv2.findContours(dominant, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if len(contours) != 1:
            raise SystemExit("Unexpected panel contour count")
        silhouette = np.zeros_like(dominant)
        cv2.drawContours(silhouette, contours, 0, 255, thickness=cv2.FILLED)
        panel_result = np.full((*silhouette.shape, 3), 255, dtype=np.uint8)
        panel_result[silhouette > 0] = (25, 60, 90)
        Image.fromarray(panel_result).save(output / "panel-isolated.png")
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
        '<svg xmlns="http://www.w3.org/2000/svg" width="2610mm" height="10mm" viewBox="0 0 2610 10">'
        f'<path d="{path.attrib["d"].strip()}" fill="{path.attrib["fill"]}"/>'
        '</svg>'
    )
    (output / "divider-importable.svg").write_text(cleaned, encoding="utf-8")
    (output / "divider-manifest.json").write_text(json.dumps({
        "source": str(source), "crop_px": [1900, 500, 4560, 555],
        "foreground_offset_within_crop_px": [30, 25],
        "foreground_size_px": [2610, 10], "wall_size_mm": [4766, 2690],
        "foreground_bbox_mm_from_image": [1930, 525, 2610, 10],
        "paths": len(nonwhite),
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
    vtracer.convert_image_to_svg_py(
        str(output / "panel-isolated.png"), str(output / "panel-raw.svg"),
        colormode="color", hierarchical="stacked", mode="spline",
        filter_speckle=8, color_precision=4, layer_difference=16,
        corner_threshold=60, length_threshold=4, max_iterations=10,
        splice_threshold=45, path_precision=3,
    )
    panel_paths = ET.parse(output / "panel-raw.svg").findall("svg:path", ns)
    # VTracer's layered representation is not a one-to-one object extraction:
    # the first path is a full rectangle and selecting it alone is wrong.
    # For this color-constrained silhouette, OpenCV's existing contour result
    # gives a single clean editable SVG path with an explicit pixel tolerance.
    polygon = cv2.approxPolyDP(contours[0], epsilon=2.0, closed=True).reshape(-1, 2)
    x0, y0 = np.min(polygon, axis=0)
    x1, y1 = np.max(polygon, axis=0)
    width_px, height_px = int(x1 - x0), int(y1 - y0)
    path_data = "M" + " L".join(f"{int(x - x0)} {int(y - y0)}" for x, y in polygon) + " Z"
    panel_svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width_px}mm" height="{height_px}mm" viewBox="0 0 {width_px} {height_px}">'
        f'<path d="{path_data}" fill="#193C5A"/>'
        '</svg>'
    )
    # Placement is kept in the manifest; the SVG itself is an independent
    # shape with no embedded image or dependency on the original wall image.
    (output / "panel-importable.svg").write_text(panel_svg, encoding="utf-8")
    (output / "panel-manifest.json").write_text(json.dumps({
        "source": str(source), "crop_px": list(panel_box),
        "wall_size_mm": [4766, 2690],
        "panel_bbox_mm_from_image": [int(panel_box[0] + x0), int(panel_box[1] + y0), width_px, height_px],
        "raw_vtracer_paths": len(panel_paths), "svg_paths": 1,
        "polygon_nodes": len(polygon), "max_approx_error_px": 2.0,
        "warning": "Color-thresholded silhouette; source pixels are not measured manufacturing geometry."
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output / "divider-raw.svg")
    print(output / "divider-importable.svg")
    print(f"Lettering trace: {len(lettering_paths)} paths, zero editable text objects")
    print(f"Panel silhouette: {len(panel_paths)} VTracer layers rejected; one contour path, {len(polygon)} nodes")


if __name__ == "__main__":
    main()
