# The method

This file explains the formulas behind `scripts/lib.mjs`. `SKILL.md` defines the terms. The code is the source of truth: if this file and `lib.mjs` disagree, `lib.mjs` is correct, and this file needs an update.

## One pass over the pixels

The script reads a raster. It rasterizes vector input first, at a 1024px longest edge, so an SVG measures like the bitmap that a browser paints from it. For each pixel with alpha above the trimming threshold:

```
luma         = 0.299 R + 0.587 G + 0.114 B       Rec. 601
contrast     = |luma − background luma| / 255    0 to 1
             skip the pixel when contrast ≤ 0.02 (it is background)
mass weight  w = alpha × contrast²               for position
size weight  s = alpha × contrast                for size
```

Position and size need different weights:

- **Position uses contrast squared.** At half contrast, a pixel gets a quarter of the weight. So a faint accent hangs below the strong ink and does not pull it. On a mark with one contrast, the weights are equal, and the result is the alpha centroid.
- **Size uses linear contrast.** The squared form turns differences in color into differences in size. With it, a coral wordmark would measure a third smaller than a black wordmark of the same shape.

The background threshold of 0.02 lets background pixels be excluded; translucent edges still change after compositing. Without it, a white background in the file pulls every centroid toward the box center.

## The visual center

```
alpha centroid   Σ(alpha · p) / Σ alpha
mass centroid    Σ(w · p) / Σ w
faint-ink share  Σ alpha where contrast < 0.6  ÷  Σ alpha
mass             faint-ink share ≤ 1/3 ? mass centroid : alpha centroid
extent center    center of the ink box (alpha ≥ 128)
                 strong ink only, while the accent discount applies
visual center    extent + 0.5 × (mass − extent)
offset           box center − visual center      positive y moves down
```

The two readings fail in opposite directions:

- The extent center ignores where the weight is. A triangle on its box center looks low.
- The mass centroid ignores where the shape ends. A triangle on its mass centroid looks high.

For a triangle, the two errors are almost equal, so the midpoint is the answer. In exact terms, the mass centroid of a solid triangle is a third of its height above its base. Its box center is at half its height. So, from box centering, the mass centroid moves the triangle up by a sixth of its height. The visual center moves it up by a twelfth.

**The accent discount** is the condition on the `mass` line. It is for an accent, not for a second tone. When faint ink is more than 1/3 of the ink, the eye reads it with the rest of the mark. A discount would then move the whole mark toward the darker tone.

**The ink box** counts only pixels that are at least half opaque. Resampling leaves almost transparent pixels at the edges, and their color is noise after unpremultiplication. If the ink box counted them, it would grow to the edge of an accent that the mass centroid just discounted.

**Fallbacks:**

1. If the faint-ink share is above 1/3, or no pixel has weight, the mass is the alpha centroid.
2. If no ink is measurable, measurement fails clearly.

## The perceived size

```
visual size      √ Σ s
perceived size   √( visual size × ink height )
baseline         min( row height ÷ ink height , max width ÷ ink width )
baseline perceived size = perceived size × baseline
correction       target perceived size ÷ baseline perceived size  (default)
```

`equalize` works in three steps:

1. It fits each element to the row: the baseline is the scale that fits its ink box in the row height and the maximum width.
2. It picks a target. `fit` is the smallest baseline size, so no element grows past its cell. `median` is the median. A file name makes that element the anchor, for example the keyline square of an icon set.
3. It scales each element by the correction. Without `--grow`, a correction above 1 stays at 1, and the output marks that row as clamped.

The default uses perceived size directly, including unequal width-limited baseline heights.
The historical power 0.5 has an exact meaning at equal baseline heights. When all elements start at one ink height, the correction makes their perceived sizes equal. Perceived size gives the mass and the extent equal weight, as the visual center does. A power of 1 makes the ink areas equal, and that goes too far, because it ignores the extent.

## Offsets and the clamp

Apply the offset as a translation of the element. Clamp the applied offset so that the artwork stays inside its safe area. A strongly skewed mark could otherwise move past the edge of its container.

A clamp can stop a correction completely. A wordmark that fills the width of its art box cannot move horizontally. Leave free space in the art box on the axis that needs a correction.

## Why zero is not reachable

A rendered element never lands exactly on the center. There are three causes:

1. **Whole pixels.** Placement uses integer coordinates, so up to half a pixel of each offset rounds away.
2. **Edge pixels.** An anti-aliased edge pixel is part artwork and part background. After compositing, its contrast changes, so the visual center of the output moves a small distance from the measurement of the artwork. You can correct this cause: measure the output, move it by the residual, and repeat until the position stops changing. `renderTile` and `renderFrame` do this.
3. **The clamp.** An element that fills its safe area cannot move on that axis.

So the gate is a tolerance (1% or less off center), not zero. A residual below one pixel is smaller than the pixel grid can show.

## The constants

| constant | value | controls | set by |
|---|---|---|---|
| `BACKGROUND_CONTRAST` | 0.02 | which pixels are background | an opaque export must measure like a transparent one |
| `EXTENT_ALPHA` | 128 | which pixels set the ink box | half opaque, so edge pixels from resampling cannot grow the box |
| `ACCENT_CONTRAST` | 0.6 | which ink is faint | the Amazon smile measures 0.35 on white and 0.65 inverted on black, and the threshold is between them |
| `ACCENT_MAX_SHARE` | 1/3 | when faint ink stops being an accent | the lighter PayPal blue is 41% of its mark and must keep its full weight |
| `CENTER_BLEND` | 0.5 | where the visual center sits between extent and mass | box centering and mass centering miss a triangle by almost equal amounts in opposite directions |
| size power | 0.5 | how strongly a set is equalized | it makes perceived sizes equal at one ink height; the icon-set calibration in [EVIDENCE.md](EVIDENCE.md) checks the equation, not human preference |
| `DEFAULT_RASTER_EDGE` | 1024px | the raster size of vector input | a fixed size, so that one SVG always gives one result; no experiment set this value |

The Amazon and PayPal values come from the skill's write-up, which its build measures again from the source artwork. See [EVIDENCE.md](EVIDENCE.md) for the commands.

## Output contracts

`visualSize` and `sizes.contrast` both mean linear-contrast visual size.
`massArea` and `sizes.mass` use squared contrast for diagnostic comparisons.
No successful measurement contains a non-finite number. Blank input fails.
Circle placement is measured after masking. Strip gates read pixels from the flattened output.
`--max-width` applies during initial sizing and refinement, including with `--grow`.
A clamped median or named target can fail; report incompatible constraints instead of claiming equalization.
The sharp edge at one-third is retained and tested numerically. Smooth weighting remains an experiment.

Reproduce constants and contracts with `cd scripts && npm test`.
This is an implementation check, not independent perceptual validation.

Measurement and cropping exclude alpha at or below 10/255 to reject invisible resampling noise.
Reproduce the faint-input regression with `cd scripts && node --test v2-test.mjs`.
