---
name: optical-balance
description: "Center and size logos, icons, wordmarks, labels, and photo crops by their measured visual center and perceived size, not by the bounding box. Use when an element looks off center in a tile, avatar, button, pill, or lockup although it is geometrically centered; when logos at one height look like different sizes; or when an alignment or sizing decision needs a measured value instead of a nudge by eye. Triggers: optical balance, optical alignment, optically center, visually center, looks off center, sits too high, sits too low, logos look different sizes, equalize logo sizes, logo strip, logo wall."
---

# Optical balance

A layout system centers the bounding box and sizes by height. The eye reads two other things:

- the mass of the ink, weighted by its contrast with the background;
- the extent of the ink, which is where the shape ends.

This skill measures both and gives two values. The offset puts the visual center on the center of the container. The scale makes the perceived sizes of a set equal. Put each value into the placement rule, never into one instance.

## Terms

These are the words that the script prints. Use each one with this meaning only.

- **box center**: the center of the image that the layout places.
- **ink**: pixels with a contrast above 0.02 against the background.
- **faint ink**: ink with a contrast below 0.6. Strong ink has a contrast of 0.6 or more.
- **accent discount**: when faint ink is at most 1/3 of the ink, the faint ink is an accent and counts for less.
- **ink box**: the smallest box around all ink that is at least half opaque (alpha 128 or more).
- **extent center**: the center of the ink box. With the accent discount, it uses the strong ink only.
- **mass centroid**: the mean position of the ink. With the accent discount, each pixel has the weight alpha × contrast². Without it, the weight is alpha.
- **visual center**: the point halfway between the extent center and the mass centroid.
- **offset**: the move that puts the visual center on the container center. Positive y moves down.
- **visual size**: the square root of the contrast-weighted ink area.
- **perceived size**: the geometric mean of the visual size and the height of the ink box.
- **off center**: the distance from the visual center to the container center, as a percentage of the shorter side of the container.
- **size spread**: (largest − smallest perceived size) ÷ smallest perceived size, for a set.

## Inputs

- The element as a PNG, JPEG, WebP, or SVG file. The script rasterizes SVG at a 1024px longest edge.
- The background that the element renders on, as a luminance (`255` is white, `0` is black) or a hex color.
- The place where the position or the size is set: the asset bake, a component, an icon set, a layout, or a design file.

A transparent background is best. You can measure an opaque export, but only against the exact background that it was exported on.

## Setup

Install sharp once: `cd <this folder>/scripts && npm install`. Run each script from its own folder by path, because Node resolves sharp from the folder of the script.

## Procedure

1. Check the decision points below. Skip the element if it needs no correction.
2. Measure the element with the command for its case:

   | case | command | read |
   |---|---|---|
   | one element | `node scripts/optical.mjs measure <image> --bg <lum or #hex>` | `offset to apply` |
   | one element that you place by its ink | add `--trim` | `offset to apply` |
   | a square tile | `node scripts/optical.mjs tile <image> --out tile.png [--size 256] [--art 0.76] [--plate #hex]` | the `baked tile` block |
   | a set of logos | `node scripts/optical.mjs equalize <images...> --height <px> [--max-width <px>] [--target fit\|median\|<file>] [--grow]` | `correction` or `render (w x h)` |
   | a rendered row | `node scripts/optical.mjs strip <images...> --out strip.png --height <px>` | the image |
   | a photo crop | `node scripts/optical.mjs frame <photo> --out avatar.png --bg <backdrop #hex> [--tolerance 0.15] [--zoom 0.9] [--circle]` | `crop` and the `framed` block |

3. Apply the value where the rule lives:
   - an asset bake: place the element by its visual center;
   - a component: `transform: translate(...)` with a percentage, so the offset scales;
   - an SVG symbol: `transform="translate(...)"` inside the symbol;
   - an icon set: one offset for each icon name;
   - a text component: an offset in em;
   - a logo strip: one height or scale factor for each logo;
   - a design file: a px move at the measured size.
4. Render the result. Measure the rendered output against its real background.
5. If the output fails a gate, move it by the residual. Measure it again.
6. Record the measured value of the output.

## Decision points

- **Self-backgrounded elements.** Skip a disc mark, a full-bleed image, and anything that carries its own background. Nothing inside it is misplaced.
- **Already within the gates.** Leave it. Never add a manual nudge to a measured value.
- **Single-color marks.** The weights give the alpha centroid. Run the measurement anyway, because it confirms the case.
- **Two-tone marks.** Read `faint-ink share`. At 33% or less, the accent discount applies. Above 33%, all ink counts. Never override this by hand. If the answer looks wrong, check the input and the background.
- **A share near 33%.** Check the share on the source and on the output. Anti-aliased edges add faint ink, so a baked tile can measure a higher share than its artwork.
- **Solid asymmetric shapes** (triangle, arrow, chevron, pin, heart). Keep `--blend 0.5`. Do not use `--blend 1`. From box centering, the mass centroid moves a triangle up by a sixth of its height, twice the move of the visual center.
- **An icon beside a label.** Measure the icon and the label together against the button. The fix is less padding on the icon side. Put it into the button component.
- **A lockup** (a symbol beside a wordmark). Align the visual center of the symbol with the visual center of the wordmark. Measure the two parts from separate files. If you have only the combined file, split it where the column ink first drops to near zero after the symbol. Render the two parts to confirm that each holds one part. Do not split at the widest empty column, because a letter gap can be wider than the symbol gap.
- **Themes.** Measure the mark on each background, and store one offset for each theme. The background decides which ink is faint, so never reuse a light-theme offset in dark mode.
- **Text.** Measure caps labels and initials once for each typeface. Store the offset in em, and store one offset for each letter of an initials set.
- **Sets.** The default target is the smallest element, so no element grows past its cell. For an icon set with a keyline, use `--target <keyline file> --grow`. For a row with a width limit, use `--max-width`.
- **Photos.** The rule centers a subject, not a face. Use it on a plain backdrop with `--tolerance` from 0.1 to 0.2, because a backdrop has grain. A patterned background has no plain backdrop, and the visual center goes to the busiest region. For a busy scene, run a face or subject detector first. Then center the crop on its result.

## Verification gates

- **Off center: 1% or less**, measured on the rendered output against its real background. A residual below one pixel passes. Zero is not reachable: see "Why zero is not reachable" in `reference/method.md`.
- **Size spread: 3% or less** for a set. Measure each rendered element and compare the `perceived size` lines. Do not run `equalize` on the rendered elements, because it scales them to one height again and proves nothing.
- **Screenshot.** Take a settled screenshot in a real browser, before and after, side by side. Do not use a virtual-time-budget capture.
- **Code.** When the placement rule is code, add two regression tests. A two-tone fixture with faint ink at most 1/3 must put the mass centroid on the center. A fixture with faint ink above 1/3 must keep the alpha centroid.

## Failure modes

The decision points cover themes, second tones, mass alone, and busy photos. These failures are the rest:

- **Wrong background.** Always pass the real background. Against the wrong one, the strong ink can disappear, and the script gives a wrong offset with no warning.
- **Alpha-only weights.** Do not weight by alpha alone. It counts faint ink at full weight and under-corrects a two-tone mark.
- **Equal ink area.** Do not use `--strength 1`. It shrinks wide wordmarks until they look smaller than a compact solid mark.
- **The source, not the output.** Verify the rendered output. The source does not show clamping, rounding, or changes from CSS.
- **Hand-moved instances.** Do not move one instance by hand. Nobody can repeat it, and each new asset brings the error back.
- **A copied script.** Do not run a copy of a script outside `scripts/`. It fails on `import sharp`.
- **Saturated color.** The method measures luminance contrast only. A saturated red and a gray of the same luminance get the same weight, but the red looks heavier. Treat the size of a strongly colored mark as a first value, and confirm it in context.

## Reference

- `reference/method.md`: the formulas, the fallbacks, the constants, and why zero is not reachable.
- `reference/evidence.md`: worked examples with the commands that reproduce them, the icon-set calibration, prior art, and history.
- `docs/index.html`: every case as a figure, with its measurements. `docs/index-v2.html` is the same material as a blog post. Run `node scripts/build-docs.mjs` to rebuild both after any change to `scripts/lib.mjs`.
- `docs/align-demo.html`: a design-canvas demo whose align tools switch between geometric and optical alignment. Run `node scripts/build-demo.mjs` to rebuild it; the script measures every layer against the fill behind it.
- `scripts/lib.mjs`: the measurement core (`measure`, `equalize`, `renderTile`, `renderStrip`, `renderFrame`). You can import it from other Node code.
