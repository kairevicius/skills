# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=11", "pillow-heif>=0.18"]
# ///
"""Character sheet of a real person, from that person's own photos, with Gemini.

Run with uv, which installs Pillow on first use:
  uv run $SKILL_ROOT/scripts/character_sheet.py <command> ...

Commands:
  init <slug> --name N --photo P[@x0,y0,x1,y1] [--photo ...] [--role R] [--bw]
      Make the work folder, copy the photos in as references, write character.json. On an existing
      folder it only adds the new photos. The optional box crops a photo to the person, as fractions
      of its width and height (for example group.jpg@0.46,0,0.86,1). Any format Pillow or HEIC.
  gen <slug> [view ...] [--takes 2] [--max-images 30] [--dry-run]
      Generate new takes of the named views, or of every view with no pick yet. Existing takes are
      kept. Once head-front has a pick, it is sent with every other view but the profiles as the
      anchor of the face. The profiles always get at least two takes. Every image is a paid call;
      the run refuses to start above --max-images.
  pick <slug> view=take [view=take ...]
      Choose the take of each view, for example head-front=2.
  contact <slug> [--takes]
      Contact sheet JPEG for review: the real photos, then every view (the picked take, or the
      latest take marked "not picked"), each head and body tile matched to the sheet's backdrop
      grey; prints the tiles whose backdrop is off. With --takes: one sheet per group, each view on
      a row with the real photo and all its takes.
  export <slug> --dest DIR [--media-prefix P] [--width 1400]
      One WebP per picked view (under 500 KB, backdrop matched) and, on stdout, the cast entry of a
      film production.

Work folder: $CHARACTER_SHEET_DIR/<slug>/, default ~/Documents/character-sheets. Personal
photos and generated faces never go into the repository.
Key: GOOGLE_GENERATIVE_AI_API_KEY, else GEMINI_API_KEY. It is never printed or written.
"""
from __future__ import annotations

import argparse
import base64
import http.client
import io
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

MODEL = "gemini-3-pro-image"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
ROOT = Path(os.environ.get("CHARACTER_SHEET_DIR", "~/Documents/character-sheets")).expanduser()
WORKERS = 6
HARD_MAX_IMAGES = 80
# Not 504: a gateway timeout may come after the image was made, and billed.
RETRY_STATUS = {429, 500, 502, 503}
SLUG = re.compile(r"[a-z0-9][a-z0-9-]*")
IMAGE_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
IMAGE_MIME = {f".{ext}": mime for mime, ext in IMAGE_EXT.items()}
EXPORT_BUDGET = 500_000
EXPORT_QUALITIES = (86, 80, 74, 68, 60, 52)
REF_LONG_SIDE = 2048
# A crop smaller than this is upscaled so the model sees the face at a usable size; one under the
# warning size has too little detail to trust.
REF_MIN_LONG_SIDE = 1024
REF_WARN_LONG_SIDE = 600


IDENTITY_KEYS = ("age", "build", "skin", "face", "hair", "eyes", "facial_hair", "marks")
WARDROBE_KEYS = ("top", "bottom", "shoes")


# How each of the person's own sides appears in a view, keyed by the view's `sides`. Without this, a
# profile drew a left-side tattoo on the side in view (2 of 13 tattoo views); each mark is now placed
# or hidden by name, so the model never works out left and right itself.
SIDES = {
    "front": ("The person faces the lens, so their own left side is on the RIGHT of the image.",
              {"left": "shows, on the RIGHT of the image", "right": "shows, on the LEFT of the image", "centre": "shows"}),
    "left-near": ("Their own left side is nearer the lens.",
                  {"left": "shows, on the side nearer the lens", "right": "on the far side, mostly hidden",
                   "centre": "shows"}),
    "right-near": ("Their own right side is nearer the lens.",
                   {"left": "on the far side, mostly hidden", "right": "shows, on the side nearer the lens",
                    "centre": "shows"}),
    "left-only": ("Only their own left side shows; their right side is hidden.",
                  {"left": "shows", "right": "hidden in this view: do not draw it", "centre": "shows in profile"}),
    "right-only": ("Only their own right side shows; their left side is hidden.",
                   {"left": "hidden in this view: do not draw it", "right": "shows", "centre": "shows in profile"}),
    "back": ("Their back is to the lens, so their own left side is on the LEFT of the image.",
             {"left": "shows from behind, on the LEFT of the image", "right": "shows from behind, on the RIGHT of the image",
              "centre": "hidden in this view: it is on the front"}),
}
SWAP = {"left": "right", "right": "left", "centre": "centre"}
MARK_SIDES = tuple(SWAP)


@dataclass(frozen=True)
class View:
    label: str
    group: str
    aspect: str
    # A mirror view leaves this empty: it is sent with the shot of the view it mirrors.
    shot: str = ""
    # Only the identity facts and garments that the frame shows: trousers and shoes named in an
    # eyes close-up make the model widen the frame to a full body.
    facts: tuple[str, ...] = IDENTITY_KEYS
    wears: tuple[str, ...] = ("top",)
    sides: str = "front"
    # The frame edges show the grey backdrop; the eye and skin macros are filled by the face.
    backdrop: bool = True
    # Made as the mirror image of this view: the photos go in flipped and the result comes out flipped,
    # so the person's own sides stay true.
    mirror_of: str | None = None
    # Receives the picked front view as the anchor of the face. The profiles do not: with the front
    # anchor they turned only 50 to 80 degrees in 4 of 8 takes.
    anchor: bool = True
    # The fewest takes a run makes of this view, whatever --takes says.
    min_takes: int = 1

    @property
    def shows_face(self) -> bool:
        return "face" in self.facts


HEAD = "Tight head-and-shoulders portrait, 85 mm lens at eye level, the top of the shoulders in frame, "
BODY = ("Full body from head to toe, standing upright on the seamless floor, arms relaxed at the sides, 35 mm lens at chest "
        "height, both shoes fully visible, empty space above the head and below the feet, ")
# About one profile take in four still turns only 60 to 75 degrees, whatever the wording, so the
# profiles always get two takes and a pick.
PROFILE = ("exact 90-degree side profile, like the head on a coin: the outline of the forehead, nose, lips and chin "
           "stands against the grey background, the far eye and the far cheek cannot be seen at all, the nose points to "
           "the LEFT edge of the image, the near ear fully visible.")
# Left and right always mean the edges of the image, never the person's own left or right: the
# model mixes the two up when the prompt says "his left".
VIEWS: dict[str, View] = {
    # The front is the anchor of the other views, so it receives none itself.
    "head-front": View("Front", "head", "4:5", HEAD + "facing the lens squarely, eyes to the lens.", anchor=False),
    "head-34-left": View("3/4 left", "head", "4:5", HEAD + (
        "head and shoulders turned about 45 degrees so the face points toward the LEFT edge of the image; both eyes "
        "visible, the far cheek partly hidden, eyes looking where the face points."), sides="left-near"),
    "head-34-right": View("3/4 right", "head", "4:5", HEAD + (
        "head and shoulders turned about 45 degrees so the face points toward the RIGHT edge of the image; both eyes "
        "visible, the far cheek partly hidden, eyes looking where the face points."), sides="right-near"),
    "head-profile-left": View("Profile left", "head", "4:5", HEAD + PROFILE, sides="left-only", anchor=False,
                              min_takes=2),
    # Asked for directly, the right-facing profile turned only 60 to 75 degrees in 5 of 13 takes; the
    # left-facing one was strict in 9 of 9 cases, so this view is its mirror image.
    "head-profile-right": View("Profile right", "head", "4:5", mirror_of="head-profile-left", anchor=False, min_takes=2),
    "head-above": View("Slightly from above", "head", "4:5", (
        "High-angle head-and-shoulders portrait, 85 mm lens: the camera is clearly above the head, about 50 cm higher "
        "than the eyes and tilted down about 25 degrees, so the crown and the top of the hair are visible, the forehead "
        "looks larger and the chin smaller. The head stays level; only the eyes look up into the lens. No hands in frame.")),
    "body-front": View("Body front", "body", "2:3", BODY + "facing the lens.", wears=WARDROBE_KEYS),
    # Right-facing on purpose: asked for a left-facing full body, the model drew it facing right in
    # four takes out of four.
    "body-side": View("Body side", "body", "2:3", BODY + (
        "strict side view: the body turned 90 degrees so the face, the chest and the toes point to the RIGHT edge of "
        "the image; the far arm and leg hidden behind the near ones."), wears=WARDROBE_KEYS, sides="right-only"),
    "body-back": View("Body back", "body", "2:3", BODY + (
        "back to the lens: the back of the head, the hair at the nape and the back of the collar visible."),
        facts=("age", "build", "skin", "hair", "marks"), wears=WARDROBE_KEYS, sides="back"),
    "detail-eyes": View("Eyes", "details", "16:9", (
        "Extreme close-up of the eyes and brows only, from the bridge of the nose to the lower forehead, filling a wide "
        "frame, 100 mm macro, facing the lens, eyes open to the lens. Nothing below the nose is in frame."),
        facts=("age", "skin", "face", "eyes", "marks"), wears=(), backdrop=False),
    # With no garment named, the model widened this crop and drew bare shoulders (3 of 9 first takes).
    "detail-skin": View("Skin and mouth", "details", "4:5", (
        "Macro close-up, 100 mm, facing the lens, that fills the whole frame with the lower half of the face: the top edge "
        "of the frame cuts just under the eyes, the bottom edge just under the chin. The nose, the cheeks, the closed "
        "mouth, the chin and the jaw, real skin texture; nothing else in frame."),
        facts=("age", "skin", "face", "facial_hair", "marks"), backdrop=False),
    "detail-hands": View("Hands", "details", "4:5", (
        "Close-up of both hands resting relaxed on the edge of a plain pale wooden table, the forearms and the sleeve ends "
        "visible, the face out of frame. Five fingers on each hand, natural nails."), facts=("age", "build", "skin", "marks"),
        backdrop=False),
    "detail-neckline": View("Neckline", "details", "4:5", (
        "Close-up from the lips down to the middle of the chest, facing the lens: the neckline and fabric of the top, the "
        "neck and both shoulders, 85 mm; the eyes out of frame."),
        facts=("age", "build", "skin", "facial_hair", "marks"), backdrop=False),
}
GROUPS = tuple(dict.fromkeys(v.group for v in VIEWS.values()))

# "Casting sheet" in this line made the model return collages of several views.
LOOK = ("One single studio reference photograph of one view, never a collage. {grade} Plain light neutral grey seamless "
        "studio background, the same flat cool light grey in every frame, soft even frontal key light with bounce fill, no "
        "dramatic shadows, natural photographic softness, no sharpening, no HDR. Neutral expression, mouth closed. Real, "
        "unretouched skin: pores, fine lines, natural asymmetry. No text, no labels, no logo, no props unless named.")
GRADE = {"colour": "Natural colour under neutral white studio light, the skin tone true to the person.",
         "bw": "Pure black and white, fine grain."}
# A view that hides the face must not ask for the same face: the model then returns no image.
SAME_FACE = ("The person is exactly the individual in the reference photos: same face, hair, build and clothes. Preserve the "
             "face with absolute fidelity to the reference photos: eye shape, colour and spacing, brows, nose, cheekbones, "
             "jawline, chin, lips, hairline, ears, skin tone, marks and age. Do not slim, beautify, smooth or restyle.")
SAME_BODY = "The hair, skin tone, build and clothes are exactly those of the person in the reference photos."
NEVER = ("Never: a second person, a mirror, a split frame or collage, text, a watermark, a logo or brand mark on the clothes, "
         "a hat, a changed face, a younger or older face, plastic or airbrushed skin.")
BARE = "No watch, no rings, no bracelet, no necklace, no earrings, no piercings, no glasses."
# What is wrong with the reference photos, set in character.json `conditions`: each adds its fixed
# correction to every prompt, so a hard photo gets the same tested wording every time.
CONDITIONS = {
    "wide-angle-selfie": ("The photos are close wide-angle selfies: keep the identity but draw the true proportions seen "
                          "through an 85 mm lens from two metres, a smaller nose, the ears fully visible, no distortion."),
    "colour-cast": ("The light of the photos tints them: use neutral white studio light and the true skin, hair and clothes "
                    "colours of the description, never the tint."),
    "black-and-white": "The photos are black and white: take every colour from the description, not from the photos.",
    "low-quality": ("The photos are small, dark, noisy, blurred or compressed: draw a sharp, clean studio photo. Keep the "
                    "face shape, features and proportions the photos show; invent only fine detail such as pores, and copy "
                    "no noise, blur or compression blocks."),
    "eyes-hidden": "Sunglasses or shadow hide the eyes in the photos: draw open eyes as the description says, no sunglasses.",
    "headwear-removed": "The cap, hat or beanie of the photos is gone: show the hair as the description says.",
    "not-at-rest": ("The photos catch a smile, a laugh or a squint: draw the same face at rest, mouth closed, without the "
                     "lifted cheeks and narrowed eyes of that moment."),
    "props": "Leave out every object the person holds or leans on in the photos: the hands are empty.",
    "other-people": "Other people appear in the photos: draw only the person the description names.",
}


def die(msg: str) -> None:
    sys.exit(f"character_sheet: {msg}")


def folder(slug: str) -> Path:
    if not SLUG.fullmatch(slug):
        die(f"bad slug '{slug}': use lowercase letters, digits and hyphens")
    return ROOT / slug


def in_repository(path: Path) -> bool:
    """True inside a git work tree: real photos and unapproved sheets never go there."""
    p = path.expanduser().resolve()
    return any((d / ".git").exists() for d in (p, *p.parents))


def check_root() -> None:
    if in_repository(ROOT):
        die(f"{ROOT} is inside a git repository; set CHARACTER_SHEET_DIR to a folder outside it")


def load(slug: str) -> dict:
    check_root()
    path = folder(slug) / "character.json"
    if not path.exists():
        die(f"no character '{slug}' in {ROOT}; run init first")
    return json.loads(path.read_text())


def save(c: dict) -> None:
    (folder(c["slug"]) / "character.json").write_text(json.dumps(c, indent=2, ensure_ascii=False) + "\n")


def version_dir(c: dict) -> Path:
    return folder(c["slug"]) / f"v{c['version']}"


def label(c: dict, view: str) -> str:
    return c.get("labels", {}).get(view, VIEWS[view].label)


def take_no(p: Path) -> int:
    return int(p.stem.rsplit("-t", 1)[1])


def takes_of(c: dict, view: str) -> list[Path]:
    return sorted((version_dir(c) / "takes").glob(f"{view}-t*.*"), key=take_no)


def picked(c: dict, view: str) -> Path | None:
    # Picks belong to the version they were made in: after a version raise, the old picks would name new,
    # unreviewed takes of the same number.
    if c.get("picks_version", 1) != c["version"]:
        return None
    take = c.get("picks", {}).get(view)
    if take is None:
        return None
    match = [p for p in takes_of(c, view) if p.stem == f"{view}-t{take}"]
    return match[0] if match else None


def shown(c: dict, view: str) -> Path | None:
    """The take that stands for a view on the sheet: the picked one, else the latest."""
    return picked(c, view) or (takes_of(c, view)[-1:] or [None])[0]


def wardrobe_line(c: dict, keys: tuple[str, ...] = WARDROBE_KEYS) -> str:
    return "; ".join(c["wardrobe"][k] for k in keys if c["wardrobe"].get(k))


def marks_line(c: dict, v: View, mirrored: bool) -> str:
    """Each one-sided mark of `marks`, placed or hidden for this view. In mirror space the person's sides swap."""
    if "marks" not in v.facts or not c.get("marks"):
        return ""
    intro, where = SIDES[v.sides]
    parts = []
    for m in c["marks"]:
        side = SWAP[m["side"]] if mirrored else m["side"]
        own = "" if side == "centre" else f" (on their own {side} side)"
        parts.append(f"{m['what']}{own}: {where[side]}")
    return f" {intro} Marks in this view: {'; '.join(parts)}. Skin with no listed mark is bare."


def identity_line(c: dict, v: View, mirrored: bool = False) -> str:
    i = c["identity"]
    line = "The person: " + "; ".join(i[k] for k in v.facts if i.get(k)) + "." + marks_line(c, v, mirrored)
    if v.wears:
        line += f" Wearing: {wardrobe_line(c, v.wears)}."
    worn = c["accessories"]
    return line + (f" Accessories, always: {', '.join(worn)}." if worn else f" {BARE}")


ANCHOR = ("The last reference image is the approved studio front view of this person: match its face, hair, skin and "
          "clothes exactly; the other reference images are the real photos.")


def prompt(c: dict, view: str, anchored: bool = False) -> str:
    """The prompt of a view. A mirrored view gets the prompt of the view it mirrors, for the flipped photos."""
    mirrored = VIEWS[view].mirror_of is not None
    v = VIEWS[VIEWS[view].mirror_of or view]
    fixes = c.get("fixes", {}).get("all", []) + c.get("fixes", {}).get(view, [])
    lines = [LOOK.format(grade=GRADE[c["look"]]), v.shot, SAME_FACE if v.shows_face else SAME_BODY]
    if anchored:
        lines.append(ANCHOR)
    lines += [identity_line(c, v, mirrored), NEVER]
    if c.get("conditions"):
        lines.append("About the reference photos: " + " ".join(CONDITIONS[k] for k in c["conditions"]))
    if fixes:
        lines.append("Corrections: " + " ".join(fixes))
    return "\n".join(lines)


def cmd_init(a: argparse.Namespace) -> None:
    check_root()
    base = folder(a.slug)
    refs = base / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    path = base / "character.json"
    c = json.loads(path.read_text()) if path.exists() else {
        "format": "well-character/1", "slug": a.slug, "name": a.name, "role": a.role or "", "version": 1,
        "status": "draft", "fictional": False, "look": "bw" if a.bw else "colour",
        "identity": {k: "" for k in IDENTITY_KEYS}, "accessories": [],
        "wardrobe": {k: "" for k in WARDROBE_KEYS}, "conditions": [], "references": [], "labels": {},
        "fixes": {"all": []}, "picks": {}, "picks_version": 1, "assumed": [],
    }
    sources = c.setdefault("sources", [])
    for arg in a.photo:
        src, _, box = arg.partition("@")
        photo = Path(src).expanduser().resolve()
        source = f"{photo}@{box}" if box else str(photo)
        if source in sources:
            print(f"{arg}: already a reference, skipped")
            continue
        sources.append(source)
        im = ImageOps.exif_transpose(Image.open(photo))
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            flat = Image.new("RGB", im.size, (200, 200, 200))
            flat.paste(im, mask=im.getchannel("A"))
            im = flat
        im = im.convert("RGB")
        if box:
            x0, y0, x1, y1 = (float(v) for v in box.split(","))
            if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
                die(f"bad crop box '{box}': use x0,y0,x1,y1 as fractions, x0 < x1 and y0 < y1")
            im = im.crop((round(x0 * im.width), round(y0 * im.height), round(x1 * im.width), round(y1 * im.height)))
        name = f"refs/photo-{len(c['references']) + 1}.jpg"
        if max(im.size) < REF_WARN_LONG_SIDE:
            print(f"{name}: only {im.width}x{im.height} px. Add the low-quality condition, and ask for a sharper photo "
                  "if the face comes out invented.")
        if max(im.size) < REF_MIN_LONG_SIDE:
            scale = REF_MIN_LONG_SIDE / max(im.size)
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        im.thumbnail((REF_LONG_SIDE, REF_LONG_SIDE))
        im.save(base / name, "JPEG", quality=92)
        c["references"].append(name)
    save(c)
    print(f"{path}\nFill identity, accessories, wardrobe and conditions from the photos before gen.")


def inline(p: Path, flip: bool = False) -> dict:
    """An image part of a request; flipped, for a view made in mirror space."""
    if flip:
        buf = io.BytesIO()
        ImageOps.mirror(Image.open(p).convert("RGB")).save(buf, "JPEG", quality=95)
        data, mime = buf.getvalue(), "image/jpeg"
    else:
        data, mime = p.read_bytes(), IMAGE_MIME.get(p.suffix.lower(), "image/jpeg")
    return {"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}}


def call(key: str, model: str, refs: list[dict], text: str, aspect: str) -> tuple[bytes, str] | str:
    body = json.dumps({"contents": [{"parts": refs + [{"text": text}]}],
                       "generationConfig": {"responseModalities": ["IMAGE"],
                                            "imageConfig": {"aspectRatio": aspect, "imageSize": "2K"}}}).encode()
    for wait in (10, 30, None):
        req = urllib.request.Request(ENDPOINT.format(model=model), data=body, method="POST",
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code in RETRY_STATUS and wait:
                time.sleep(wait)
                continue
            return f"HTTP {e.code}: {e.read().decode(errors='replace')[:160]}"
        # No retry on a network error or a timeout: the server may already have made, and billed, the image.
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as e:
            return f"error {type(e).__name__}"
        # A bad header value or an unreadable body; the header error text holds the key, so it is not shown.
        except ValueError:
            return "error: the request header or the response body is not valid"
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "inlineData" in part:
                mime = part["inlineData"].get("mimeType", "")
                if mime not in IMAGE_EXT:
                    return f"unexpected image type '{mime}'"
                return base64.b64decode(part["inlineData"]["data"]), IMAGE_EXT[mime]
    return f"no image: {(data.get('candidates') or [{}])[0].get('finishReason')}"


def cmd_gen(a: argparse.Namespace) -> None:
    c = load(a.slug)
    if c["status"] == "locked":
        die(f"v{c['version']} is locked; raise version and set status to draft for a new sheet")
    missing = [k for k in ("face", "hair", "eyes") if not c["identity"].get(k)] + ([] if c["wardrobe"].get("top") else
                                                                                ["wardrobe.top"])
    if missing:
        die(f"character.json lacks {', '.join(missing)}; fill them from the photos first")
    unknown_conditions = [k for k in c.get("conditions", []) if k not in CONDITIONS]
    if unknown_conditions:
        die(f"unknown conditions {unknown_conditions}; known: {', '.join(CONDITIONS)}")
    bad_marks = [m for m in c.get("marks", []) if not m.get("what") or m.get("side") not in MARK_SIDES]
    if bad_marks:
        die(f"each mark needs 'what' and a 'side' of {', '.join(MARK_SIDES)}: {bad_marks}")
    # A view named twice would get the same take numbers, and one paid image would overwrite the other.
    views = list(dict.fromkeys(a.views)) or [v for v in VIEWS if not picked(c, v)]
    if not views:
        die("every view has a pick; name the views to generate again")
    unknown = [v for v in views if v not in VIEWS]
    if unknown:
        die(f"unknown views {unknown}; known: {', '.join(VIEWS)}")
    planned = sum(max(a.takes, VIEWS[v].min_takes) for v in views)
    if planned > min(a.max_images, HARD_MAX_IMAGES):
        die(f"{planned} images planned, over --max-images {a.max_images} (hard cap {HARD_MAX_IMAGES})")
    # The picked front view anchors every other view, so a hard photo cannot pull them to different faces.
    anchor = picked(c, "head-front")
    anchored = {v: bool(anchor) and VIEWS[v].anchor for v in VIEWS}
    if a.dry_run:
        for v in views:
            note = f", made as the mirror of {VIEWS[v].mirror_of} from flipped photos" if VIEWS[v].mirror_of else ""
            print(f"--- {v} ({VIEWS[v].aspect}{note})\n{prompt(c, v, anchored[v])}\n")
        print(f"{planned} paid images planned, {len(c['references'])} reference photos per call"
              f"{' + the front anchor' if anchor else ''}, model {a.model}")
        return
    key = (os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY") or os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key or any(ch.isspace() for ch in key):
        die("set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY to the key alone, with no space or line break")
    out = version_dir(c) / "takes"
    out.mkdir(parents=True, exist_ok=True)
    flips = {False} | {VIEWS[v].mirror_of is not None for v in views}
    refs = {flip: [inline(folder(a.slug) / r, flip) for r in c["references"]] for flip in flips}
    anchor_ref = {flip: [inline(anchor, flip)] if anchor else [] for flip in flips}
    jobs = []
    for v in views:
        start = max((take_no(p) for p in takes_of(c, v)), default=0)
        jobs += [(v, start + k) for k in range(1, max(a.takes, VIEWS[v].min_takes) + 1)]

    def run(job: tuple[str, int]) -> str:
        v, take = job
        flip = VIEWS[v].mirror_of is not None
        parts = refs[flip] + (anchor_ref[flip] if anchored[v] else [])
        # One failed take must not stop the report of the paid takes still running in the other workers.
        try:
            result = call(key, a.model, parts, prompt(c, v, anchored[v]), VIEWS[v].aspect)
            if isinstance(result, str):
                return f"{v}-t{take} {result}"
            data, ext = result
            if flip:
                ImageOps.mirror(Image.open(io.BytesIO(data)).convert("RGB")).save(out / f"{v}-t{take}.png")
            else:
                (out / f"{v}-t{take}.{ext}").write_bytes(data)
        except Exception as e:
            return f"{v}-t{take} error {type(e).__name__}"
        return f"{v}-t{take} ok"

    with ThreadPoolExecutor(WORKERS) as ex:
        for line in ex.map(run, jobs):
            print(line, flush=True)
    (version_dir(c) / "prompts.json").write_text(json.dumps({v: prompt(c, v, anchored[v]) for v in VIEWS}, indent=2) + "\n")


def cmd_pick(a: argparse.Namespace) -> None:
    c = load(a.slug)
    if c["status"] == "locked":
        die(f"v{c['version']} is locked")
    for pair in a.picks:
        view, _, take = pair.partition("=")
        if view not in VIEWS or not take.isdigit():
            die(f"bad pick '{pair}'; use view=take, for example head-front=2")
        if not any(p.stem == f"{view}-t{take}" for p in takes_of(c, view)):
            die(f"no take {take} of {view}")
        if c.get("picks_version", 1) != c["version"]:
            c["picks"] = {}
        c["picks_version"] = c["version"]
        c.setdefault("picks", {})[view] = int(take)
    save(c)
    print(", ".join(f"{v}=t{t}" for v, t in c["picks"].items()))


def backdrop(im: Image.Image) -> tuple[float, float, float] | None:
    """The backdrop grey along the top and side edges, or None when those edges are not a plain light grey."""
    small = im.convert("RGB").resize((64, 80))
    w, h = small.size
    px = [small.getpixel((x, y)) for x in range(w) for y in (0, 1)] + \
         [small.getpixel((x, y)) for y in range(int(h * 0.6)) for x in (0, w - 1)]
    med = tuple(statistics.median(p[c] for p in px) for c in range(3))
    spread = statistics.median(max(abs(p[c] - med[c]) for c in range(3)) for p in px)
    return None if max(med) - min(med) > 45 or spread > 12 or min(med) < 110 else med


def match_backdrop(im: Image.Image, target: tuple[float, float, float] | None) -> tuple[Image.Image, float]:
    """Give a tile the sheet's backdrop grey with one gain per colour channel over the whole tile, as a white
    balance does: the model drifts between warm, neutral and bluish grey from tile to tile. The gain is capped,
    so the face is never pushed far; returns the tile and how far its backdrop still is from the target."""
    bg = backdrop(im) if target else None
    if not bg:
        return im, 0.0
    gains = [min(1.25, max(0.8, target[c] / bg[c])) for c in range(3)]
    out = Image.merge("RGB", [ch.point(lambda v, g=g: min(255, round(v * g))) for ch, g in zip(im.convert("RGB").split(), gains)])
    return out, max(abs(bg[c] * gains[c] - target[c]) for c in range(3))


BACKDROP_OFF = 20


def sheet_backdrop(c: dict) -> tuple[float, float, float] | None:
    """The median backdrop of the sheet's picked (else latest) head and body tiles: one off tile cannot move it."""
    tiles = [shown(c, v) for v in VIEWS if VIEWS[v].backdrop]
    found = [b for b in (backdrop(Image.open(t)) for t in tiles if t) if b]
    return tuple(statistics.median(b[ch] for b in found) for ch in range(3)) if found else None


# Pillow's built-in font has no accented letters: "café" printed as "caf" and a box.
FONTS = ("/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "C:/Windows/Fonts/arial.ttf")


@lru_cache
def font(size: int) -> ImageFont.ImageFont:
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def cell(path: Path, w: int, h: int, text: str, note: str = "", target=None) -> Image.Image:
    tile = Image.new("RGB", (w, h + 56), "white")
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    if target and not backdrop(im):
        note = ", ".join(n for n in (note, "backdrop not plain") if n)
        print(f"{path.stem}: the frame edges are not the plain grey backdrop (a scene, a prop or a gradient); re-roll it")
    im, off = match_backdrop(im, target)
    if off > BACKDROP_OFF:
        note = ", ".join(n for n in (note, "backdrop off") if n)
        print(f"{path.stem}: backdrop still {off:.0f} levels from the sheet's grey; re-roll it")
    im = ImageOps.contain(im, (w, h))
    tile.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    draw = ImageDraw.Draw(tile)
    draw.text((8, h + 6), text, fill="black", font=font(22))
    if note:
        draw.text((8, h + 32), note, fill="#b42318", font=font(17))
    return tile


def grid(cells: list[Image.Image], cols: int) -> Image.Image:
    w, h = cells[0].size
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w + (cols + 1) * 12, rows * h + (rows + 1) * 12), "#e9e9e9")
    for i, im in enumerate(cells):
        sheet.paste(im, (12 + (i % cols) * (w + 12), 12 + (i // cols) * (h + 12)))
    return sheet


def cmd_contact(a: argparse.Namespace) -> None:
    c = load(a.slug)
    base, vdir = folder(a.slug), version_dir(c)
    vdir.mkdir(parents=True, exist_ok=True)
    real = [cell(base / r, 360, 450, f"Real photo {i + 1}") for i, r in enumerate(c["references"])]
    target = sheet_backdrop(c)
    if not a.takes:
        cells = list(real)
        for v in VIEWS:
            src = shown(c, v)
            if src:
                note = "" if src == picked(c, v) else f"t{take_no(src)}, not picked"
                cells.append(cell(src, 360, 450, label(c, v), note, target if VIEWS[v].backdrop else None))
        path = vdir / "contact.jpg"
        grid(cells, 5).save(path, "JPEG", quality=88)
        print(path)
        return
    all_takes = {v: takes_of(c, v) for v in VIEWS}
    for group in GROUPS:
        rows = [v for v in VIEWS if VIEWS[v].group == group and all_takes[v]]
        if not rows:
            continue
        width = 1 + max(len(all_takes[v]) for v in rows)
        cells = []
        for v in rows:
            chosen = picked(c, v)
            row = [cell(base / c["references"][0], 300, 375, label(c, v), "real photo")]
            for p in all_takes[v]:
                row.append(cell(p, 300, 375, f"t{take_no(p)}", "picked" if p == chosen else ""))
            row += [Image.new("RGB", row[0].size, "#e9e9e9")] * (width - len(row))
            cells += row
        path = vdir / f"takes-{group}.jpg"
        grid(cells, width).save(path, "JPEG", quality=88)
        print(path)


def cmd_export(a: argparse.Namespace) -> None:
    c = load(a.slug)
    missing = [v for v in VIEWS if not picked(c, v)]
    if missing:
        die(f"pick a take of every view first; missing: {', '.join(missing)}")
    dest = Path(a.dest).expanduser()
    if c["status"] != "locked" and in_repository(dest):
        die(f"v{c['version']} is a draft: lock it after the person approves the sheet (step 9) before an export into a "
            "repository")
    dest.mkdir(parents=True, exist_ok=True)
    sheet = []
    target = sheet_backdrop(c)
    for v in VIEWS:
        im, _ = match_backdrop(Image.open(picked(c, v)).convert("RGB"), target if VIEWS[v].backdrop else None)
        if im.width > a.width:
            im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
        name = f"{c['slug']}-{v}.webp"
        for q in EXPORT_QUALITIES:
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=q, method=6)
            if buf.tell() < EXPORT_BUDGET:
                (dest / name).write_bytes(buf.getvalue())
                break
        else:
            die(f"{name} is still over {EXPORT_BUDGET} bytes at quality {EXPORT_QUALITIES[-1]}")
        sheet.append({"src": f"{a.media_prefix.rstrip('/')}/{name}", "label": label(c, v)})
    # The contact sheet is not exported: its first tiles are the person's real photos.
    print(json.dumps({"id": c["slug"], "name": c["name"], "role": c["role"], "wardrobe": wardrobe_line(c),
                      "sheet": sheet}, indent=2, ensure_ascii=False))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("init")
    s.add_argument("slug")
    s.add_argument("--name", required=True)
    s.add_argument("--role")
    s.add_argument("--photo", action="append", required=True)
    s.add_argument("--bw", action="store_true", help="black and white instead of colour")
    s = sub.add_parser("gen")
    s.add_argument("slug")
    s.add_argument("views", nargs="*")
    s.add_argument("--takes", type=int, default=2)
    s.add_argument("--max-images", type=int, default=30)
    s.add_argument("--model", default=MODEL)
    s.add_argument("--dry-run", action="store_true")
    s = sub.add_parser("pick")
    s.add_argument("slug")
    s.add_argument("picks", nargs="+")
    s = sub.add_parser("contact")
    s.add_argument("slug")
    s.add_argument("--takes", action="store_true")
    s = sub.add_parser("export")
    s.add_argument("slug")
    s.add_argument("--dest", required=True)
    s.add_argument("--media-prefix", default="cast")
    s.add_argument("--width", type=int, default=1400)
    a = p.parse_args()
    {"init": cmd_init, "gen": cmd_gen, "pick": cmd_pick, "contact": cmd_contact, "export": cmd_export}[a.cmd](a)


if __name__ == "__main__":
    main()
