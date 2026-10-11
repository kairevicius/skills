#!/usr/bin/env python3
"""Outline a button label so the reel renders it the same on every machine.

HarfBuzz shapes the text, so kerning applies, and fontTools draws each glyph into one SVG
path. The cap tops sit at y = 0 and the baseline at the cap height. The build reads the path
with `data-cap-height` and `data-advance` to center the cap height on the button's icon.

    python3 sites/optical-balance/outline-label.py ~/Library/Fonts/Geist-Medium.otf "Get started" \\
        > sites/optical-balance/sources/get-started.svg

Needs `hb-shape` (HarfBuzz) and the fontTools package. The build itself needs neither.
"""
import json
import subprocess
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

SIZE = 16


def main(font_path, text):
    shaped = json.loads(subprocess.run(
        ["hb-shape", "--no-glyph-names", "--output-format=json", font_path, text],
        check=True, capture_output=True, text=True).stdout)
    font = TTFont(font_path)
    glyphs, order = font.getGlyphSet(), font.getGlyphOrder()
    k = SIZE / font["head"].unitsPerEm
    cap = font["OS/2"].sCapHeight * k
    path = SVGPathPen(glyphs, ntos=lambda v: f"{round(v, 2):g}")
    bounds = BoundsPen(glyphs)
    x = 0
    for g in shaped:
        # Font units are y-up; the SVG is y-down with the baseline at the cap height.
        transform = (k, 0, 0, -k, (x + g["dx"]) * k, cap - g["dy"] * k)
        for pen in (path, bounds):
            glyphs[order[g["g"]]].draw(TransformPen(pen, transform))
        x += g["ax"]
    advance = round(x * k, 2)
    top, bottom = bounds.bounds[1], bounds.bounds[3]
    family = font["name"].getDebugName(1)
    print(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{round(advance)}" height="{round(bottom - top) + 1}" viewBox="0 {round(top) - 1} {round(advance)} {round(bottom - top) + 1}" data-cap-height="{round(cap, 2)}" data-advance="{advance}">
<!-- "{text}" set in {family} at {SIZE}px, shaped with HarfBuzz and outlined with fontTools by
     outline-label.py, so it renders the same without the font. Cap tops sit at y = 0 and the
     baseline at the cap height. -->
<path d="{path.getCommands()}"/>
</svg>''')


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
