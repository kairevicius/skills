# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["dlib-bin>=19.24", "face_recognition_models>=0.3", "setuptools<81", "numpy", "pillow>=11", "pillow-heif>=0.18"]
# ///
"""Face distance between a person's real photos and generated images: the identity check a reviewer's eye misses.

Run with uv:
  uv run $SKILL_ROOT/scripts/face_match.py --person NAME=PHOTO [--person ...] IMAGE [...] [--json OUT]

For each image and each person: the distance from the person's nearest reference to the face given to that person
(dlib ResNet face descriptors). Name only the people who are in the images: a face goes to the closest person named. Give every head view of the sheet as well as the real photos: the distance grows with
the head's turn, so a turned face needs a turned reference. Below 0.45 is a close match, 0.45 to 0.50 a weak one,
0.50 and above another person. "no face" means no detector found a face, as for a back view.

Calibration (2026-11-01, one sheet as reference): other people's sheet views scored 0.537 and above; frames the
person rejected as not him scored 0.57 to 0.70; frames he accepted scored 0.34 to 0.48.
"""
from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

warnings.filterwarnings("ignore", category=UserWarning)
import dlib  # noqa: E402
import face_recognition_models as models  # noqa: E402
from pillow_heif import register_heif_opener  # noqa: E402

register_heif_opener()

CLOSE, WEAK = 0.45, 0.50
LONG_SIDE = 1600

_hog = dlib.get_frontal_face_detector()
_cnn = dlib.cnn_face_detection_model_v1(models.cnn_face_detector_model_location())
_shape = dlib.shape_predictor(models.pose_predictor_five_point_model_location())
_rec = dlib.face_recognition_model_v1(models.face_recognition_model_location())


def load(path: Path) -> np.ndarray:
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((LONG_SIDE, LONG_SIDE))
    return np.asarray(im)


def descriptors(path: Path) -> list[np.ndarray]:
    img = load(path)
    boxes = list(_hog(img, 1))
    if not boxes:
        # The HOG detector misses faces that look down or turn; the CNN detector is slower but finds them.
        boxes = [d.rect for d in _cnn(img, 1)]
    return [np.array(_rec.compute_face_descriptor(img, _shape(img, b), 1)) for b in boxes]


def verdict(d: float | None) -> str:
    if d is None:
        return "no face"
    return "close" if d < CLOSE else "weak" if d < WEAK else "other person"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--person", action="append", required=True, help="NAME=PHOTO; repeat for more photos or people")
    p.add_argument("images", nargs="+")
    p.add_argument("--json", help="write {image: {name: distance or null}} here")
    a = p.parse_args()
    refs: dict[str, list[np.ndarray]] = {}
    for arg in a.person:
        name, _, photo = arg.partition("=")
        found = descriptors(Path(photo).expanduser())
        if len(found) != 1:
            raise SystemExit(f"face_match: {photo} has {len(found)} faces; give a reference with the person's face alone")
        refs.setdefault(name, []).append(found[0])
    out: dict[str, dict[str, float | None]] = {}
    for img in map(Path, a.images):
        faces = descriptors(img)
        # Each face goes to one person, closest pairs first: a person whose face does not show gets none, instead of
        # the distance to someone else's face.
        pairs = sorted((min(float(np.linalg.norm(f - r)) for r in ref), i, name)
                       for i, f in enumerate(faces) for name, ref in refs.items())
        row: dict[str, float | None] = {name: None for name in refs}
        used: set[int] = set()
        for d, i, name in pairs:
            if row[name] is None and i not in used:
                row[name] = round(d, 3)
                used.add(i)
        out[img.name] = row
        print(f"{img.name}: " + ", ".join(f"{n} {'-' if d is None else d} ({verdict(d)})" for n, d in row.items()))
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
