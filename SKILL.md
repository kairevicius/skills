---
name: optical-balance
description: "Center and size logos, icons, wordmarks, labels, and photo crops by their measured visual center and perceived size, not by the bounding box. Use when an element looks off center in a tile, avatar, button, pill, or lockup although it is geometrically centered; when logos at one height look like different sizes; or when an alignment or sizing decision needs a measured value instead of a nudge by eye. Triggers: optical balance, optical alignment, optically center, visually center, looks off center, sits too high, sits too low, play icon looks off, logos look different sizes, equalize logo sizes, logo strip, logo wall."
---

# Optical balance

A layout system centers the bounding box and sizes by height. The eye reads two other things:

- the mass of the ink, weighted by its contrast with the background;
- the extent of the ink, which is where the shape ends.

This skill measures both and gives two values. The offset puts the visual center on the center of the container. The scale makes the perceived sizes of a set equal. Put each value into the placement rule, never into one instance.

## Terms

These are the words that the script prints. Use each one with this meaning only.

- **box center**: the center of the image as the layout places it.
- **ink**: pixels with a contrast above 0.02 against the background.
- **faint ink**: ink with a contrast below 0.6. Strong ink has a contrast of 0.6 or more.
- **accent discount**: when faint ink is at most 1/3 of the ink, the faint ink is an accent and counts for less.
- **ink box**: the smallest box around all ink that is at least half opaque.
- **extent center**: the center of the ink box. With the accent discount, it uses the strong ink only.
- **mass centroid**: the mean position of the ink, weighted by alpha × contrast² with the accent discount, or by alpha without it.
- **visual center**: the point halfway between the extent center and the mass centroid.
- **offset**: the move that puts the visual center on the container center. Positive y moves down.
- **visual size**: the square root of the contrast-weighted ink area.
- **perceived size**: the geometric mean of the visual size and the height of the ink box.
- **off center**: the distance from the visual center to the container center, as a percentage of the shorter side of the container.
- **size spread**: (largest − smallest perceived size) ÷ smallest perceived size, for a set.

## Setup

Install sharp once: `cd <skill folder>/scripts && npm install`. Then run `node <skill folder>/scripts/optical.mjs ...` from any folder. To use the library in your own script, import it by path, for example `import { measureFile } from "<skill folder>/scripts/lib.mjs"`. The library resolves sharp from its own folder.

## Inputs

- **The element**, as SVG, PNG, JPEG, or WebP. An SVG is best. A raster smaller than its render size blurs, and the script warns when it must enlarge one.
- **The background it renders on**: `--bg` with a luminance (`255` is white, `0` is black) or a hex color. Use `--bg auto` for an opaque file to read its own backdrop.
- **How the layout places it**: its container size, its element size, and whether CSS, a design file, an asset bake, or a strip layout sets the position.

Three input rules prevent most wrong answers:

1. **Give the real background.** A white or `currentColor` icon on a dark button needs `--bg` set to the button color. On the default white, it has no ink, and the script warns.
2. **Measure the file as the layout places it.** An icon in an SVG viewBox or a padded PNG is placed by its whole box, so do not use `--trim`. Use `--trim` only for an asset that the layout places by its ink, such as a trimmed logo.
3. **Treat an opaque backdrop as part of the element.** On a plate of another color, the backdrop shows as a rectangle. Check the artwork inside it with `--bg auto`, and ask for a transparent source.

## Procedure

1. **Check the layout first.** Confirm that the layout centers the element box. In a browser, compare the `getBoundingClientRect()` centers of the element and the container. A baseline gap, a shrunk flex item, or a wrong box size is a layout bug, not an optical one.
2. **Check the decision points below.** Skip the element if it needs no correction.
3. **Measure with the command for the case:**

   | case | command | read |
   |---|---|---|
   | an element in a container (CSS, a design file) | `node scripts/optical.mjs place <file> --container 40 --element 20 --plate <#hex> [--shape circle] --out pair.png` | `css` and the two `off center` lines |
   | an offset you already use | add `--offset <x%>,<y%>` to `place` | the `given offset` line |
   | one element, numbers only | `node scripts/optical.mjs measure <file> --bg <#hex>` | `offset to apply` and `css` |
   | an avatar or app tile that you bake | `node scripts/optical.mjs tile <file> --out tile.png --size 96 --art 0.75 --plate <#hex>` | block 1 for the offset, block 2 for the gate |
   | a set of logos | `node scripts/optical.mjs equalize <files...> --height <px> [--max-width <px>]` | `ink (w x h)`, or `file (w x h)` for a padded file |
   | a rendered logo row | `node scripts/optical.mjs strip <files...> --out strip.png --height <px> --scale 2` | the table and `size spread` |
   | a photo crop | `node scripts/optical.mjs frame <photo> --out avatar.png --bg <backdrop #hex> [--zoom 0.9] [--circle]` | `crop` and the `framed` block |

4. **Apply the value where the rule lives:**
   - a component: `transform: translate(x%, y%)` from the `css` line. The percentages are of the element box as placed, so they hold at every size;
   - an icon set: one offset for each icon name;
   - a text component: an offset in em;
   - an asset bake: place the element by its visual center (`tile` does this);
   - a logo row: one height for each logo, plus the `translateY` from `strip`;
   - a design file: a px move at the measured size.
5. **Verify the output.** `place` and `strip` verify their own render. For a real screenshot, crop the container and run `node scripts/optical.mjs check <crop.png> --bg <#hex>`. The command exits with code 1 when the gate fails.
6. **Record the value.** Put the measured offset next to the code that applies it, with the command that produced it.

## Decision points

- **Already within the gate.** Leave it. `place` prints "none needed" when geometric centering passes. Report the numbers, and if the user still sees a problem, check the layout (procedure step 1).
- **Self-backgrounded elements** (a disc mark, an app icon on its own colored square, a full-bleed image). Check the artwork inside with `--bg auto`. Skip centering if it passes. In a set, size it like any other logo.
- **Single-color marks.** The weights give the alpha centroid. Run the measurement anyway, because it confirms the case.
- **Two-tone marks.** Read `faint-ink share`. At 33% or less, the accent discount applies. Above 33%, all ink counts. Never override this by hand. If the share is near 33%, compare the source and the output, because anti-aliased edges add faint ink.
- **Solid asymmetric shapes** (triangle, arrow, chevron, pin, heart). Keep `--blend 0.5`. From box centering, the mass centroid moves a triangle up by a sixth of its height, twice the move of the visual center.
- **Stroke icons.** Measure the icon as an outline, as the screen shows it. Give the stroke width that renders: a `stroke-width` of 2 in a 24-unit viewBox is 1.67px at a 20px icon. Well-drawn sets often place their asymmetric glyphs optically already. Lucide's play icon measures 0.1% off center when its frame is centered.
- **An icon beside a label.** Measure the icon and the label together against the button. The fix is less padding on the icon side. Put it into the button component.
- **A lockup** (a symbol beside a wordmark). Align the visual center of the symbol with the visual center of the wordmark. Measure the two parts from separate files. A stacked lockup, with the symbol above the word, is one element: center it as a whole.
- **Themes.** Measure the mark on each background, and store one offset for each theme. The background decides which ink is faint.
- **Text.** Measure caps labels and initials once for each typeface. Store the offset in em, and store one offset for each letter of an initials set.
- **Sets.** The default target is the smallest element, so no element grows past its cell. For an icon set with a keyline, use `--target <keyline file> --grow`. For a row with a width limit, use `--max-width`.
- **Photos.** The rule centers a subject, not a face. Use it on a plain backdrop with `--tolerance` from 0.1 to 0.2, because a backdrop has grain. For a busy scene, run a face or subject detector first. Then center the crop on its result.

## Verification gates

- **Off center: 1% or less of the container's shorter side**, measured on a render at 2x or more. `place` renders at 4x. At 1x, whole-pixel rounding alone can move a 40px button by 0.6%.
- **Size spread: 3% or less** for a set, measured on the rendered logos. Use `strip --scale 2`, because at 1x a one-pixel step is about 4% of a 24px logo. CSS accepts the half-pixel heights that `strip` prints.
- **A real screenshot**, when the layout is live. Capture it at 4x, for example with headless Chrome `--force-device-scale-factor=4`. Crop the container and run `check`. Do not use a virtual-time-budget capture.
- **Code.** When the placement rule is code, add two regression tests. A two-tone fixture with faint ink at most 1/3 must put the mass centroid on the center. A fixture with faint ink above 1/3 must keep the alpha centroid.

## Failure modes

The decision points cover themes, second tones, mass alone, and busy photos. These failures are the rest:

- **A warning ignored.** The script warns about no ink, low contrast, an own background, and an enlarged raster. Each warning means the number may be wrong. Fix the input, then measure again.
- **Wrong background.** Always pass the real background. Against the wrong one, the strong ink can disappear, or a backdrop counts as ink.
- **`--trim` on a placed file.** It measures the ink box, but CSS places the whole file, so the offset has the wrong basis.
- **Alpha-only weights.** Do not weight by alpha alone. It counts faint ink at full weight and under-corrects a two-tone mark.
- **Equal ink area.** Do not use `--strength 1`. It shrinks wide wordmarks until they look smaller than a compact solid mark.
- **The source, not the output.** Verify the rendered output. The source does not show clamping, rounding, or changes from CSS.
- **Hand-moved instances.** Do not move one instance by hand. Nobody can repeat it, and each new asset brings the error back.
- **Saturated color.** The method measures luminance contrast only. A saturated red and a gray of the same luminance get the same weight, but the red looks heavier. Treat the size of a strongly colored mark as a first value, and confirm it in context.

## Reference

- `reference/method.md`: the formulas, the fallbacks, the constants, and why zero is not reachable.
- `reference/evidence.md`: worked examples with the commands that reproduce them, the validation on held-out logos and icons, prior art, and history.
- `scripts/lib.mjs`: the measurement core (`measureFile`, `renderPlacement`, `equalize`, `renderTile`, `renderStrip`, `renderFrame`).
- `scripts/test.mjs`: the regression tests. Run `npm test` in `scripts/`.
- `docs/`: the landing page, the full write-up, and a live demo of optical align tools. `npm run docs` in `scripts/` builds them.
