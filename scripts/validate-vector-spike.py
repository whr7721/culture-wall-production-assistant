"""Compare the isolated pixel silhouette with the SVG renderer at 1:1 pixels."""

from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1] / "output" / "vector-spike"
with Image.open(root / "panel-isolated.png") as image:
    expected_rgb = np.asarray(image.convert("RGB").crop((5, 70, 1595, 1947)))
with Image.open(root / "panel-svg-exact.png") as image:
    actual_rgb = np.asarray(image.convert("RGB"))
with Image.open(root / "inkscape-panel.png") as image:
    inkscape_rgba = np.asarray(image.convert("RGBA"))
if expected_rgb.shape != actual_rgb.shape:
    raise SystemExit(f"Size mismatch: {expected_rgb.shape} vs {actual_rgb.shape}")
expected = expected_rgb[:, :, 2] < 180
actual = actual_rgb[:, :, 2] < 180
intersection = np.count_nonzero(expected & actual)
union = np.count_nonzero(expected | actual)
iou = intersection / union
print(f"Panel silhouette pixel IoU: {iou:.6f}")
if iou < 0.995:
    raise SystemExit("SVG contour differs materially from selected raster silhouette")
inkscape_shape = inkscape_rgba[:, :, 3] > 127
inkscape_iou = np.count_nonzero(expected & inkscape_shape) / np.count_nonzero(expected | inkscape_shape)
print(f"Inkscape round-trip pixel IoU: {inkscape_iou:.6f}")
if inkscape_iou < 0.995:
    raise SystemExit("Design software rendering differs materially from selected silhouette")
