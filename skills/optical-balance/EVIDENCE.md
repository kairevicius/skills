# Evidence

Each result in this file comes with the command that reproduces it. Run the commands from the skill folder, after `npm ci` in `scripts/`. The logo examples use files from the repository's `sites/optical-balance/sources`, so clone the repository to rerun them. The Amazon tile and equalization outputs were rerun with luma + OKLab chroma contrast (OKLab chroma plus luminance contrast). Other examples remain historical. If a rerun gives a different output, the rerun is correct, and this file needs an update.

## Worked example: the Amazon wordmark on a tile

```
node scripts/optical.mjs tile ../../sites/optical-balance/sources/amazon.svg --out amazon-tile.png
```

The script crops the mark to its ink, fits it into the art box of a 256px tile, and measures it against white. Then it places the mark and measures the baked tile again:

```
1. artwork cropped to its ink and fitted into the art box (visual centering). The bake applies this offset; for a component, use place instead.
image            195x59, background luminance 255.0
ink box          195x59 at 0,0
box center       97.5, 29.5
alpha centroid   95.4, 22.2
mass centroid    96.1, 20.6  (contrast-weighted, accent discounted)
extent center    97.5, 29.5  (box of the ink the eye reads, 195x59)
visual center    96.8, 25.0  (extent moved 0.5 of the way to mass)
faint-ink share  0% below contrast 0.6
visual size      61.7px (sqrt of contrast-weighted ink area)
perceived size   60.4px (geometric mean of visual size and ink height; equal across an equalized set)
offset to apply  x +0.7px (+0.4%), y +4.5px (+7.6%)  (positive y moves the element down)
off center       7.65% of the shorter side (4.5px)  (to judge a rendered result, use check)

2. baked tile amazon-tile.png: its off center line is the gate
image            256x256, background luminance 255.0
ink box          195x59 at 31,103
box center       128.0, 128.0
alpha centroid   126.6, 125.5
mass centroid    127.1, 123.7  (contrast-weighted, accent discounted)
extent center    128.5, 132.5  (box of the ink the eye reads, 195x59)
visual center    127.8, 128.1  (extent moved 0.5 of the way to mass)
faint-ink share  20% below contrast 0.6
visual size      62.0px (sqrt of contrast-weighted ink area)
perceived size   60.5px (geometric mean of visual size and ink height; equal across an equalized set)
offset to apply  x +0.2px (+0.1%), y -0.1px (-0.0%)  (positive y moves the element down)
off center       0.08% of the shorter side (0.2px)  PASS at 1%
```

OKLab chroma now makes the smile strong ink, so the extent includes the whole mark.
The smaller correction replaces the historical luminance-only placement.

## Worked example: a nine-logo strip

```
node scripts/optical.mjs equalize ../../sites/optical-balance/sources/{amazon,google,stripe,slack,shopify,apple,mastercard,netflix,airbnb}.svg --height 40
```

```
target perceived size 33.9px at row height 40px
file                  equal-height  visual size  correction     ink (w x h)    file (w x h)
amazon.svg                  132x40         42.1      x0.826      109.3x33.1      109.5x33.1
google.svg                  121x40         32.4      x0.942      114.4x37.7      115.5x39.0
stripe.svg                   96x40         39.2      x0.856       82.3x34.2       82.3x34.2
slack.svg                   158x40         46.4      x0.787      124.4x31.5      125.0x31.9
shopify.svg                 140x40         40.4      x0.843      118.2x33.7      118.3x37.1
apple.svg                    33x40         28.7      x1.000       32.6x40.0       32.6x40.0
mastercard.svg               52x40         35.0      x0.907       46.7x36.3       46.7x36.3
netflix.svg                 148x40         47.7      x0.776      114.7x31.0      114.7x31.0
airbnb.svg                  128x40         31.2      x0.960      122.9x38.4      122.9x38.4
ink: the visible artwork at its new size. file: the whole file at the same scale, padding included; use it to size an <img> of the file as it is.
These are the computed sizes. strip renders them, corrects the rounding, and checks the result.
```

How to read it:

- At equal height, Netflix, Slack, and Amazon have the largest visual sizes. Apple sets the smallest perceived-size target and keeps its height.
- Apple and Mastercard are compact marks with small visual sizes at equal height. They shrink less than the wide wordmarks.
- The `file` column is larger than the `ink` column where the SVG has padding, as Google and Shopify do. Use it to size an `<img>` of the file.
- `node scripts/optical.mjs strip <same files> --out strip.png --height 40` renders each file at its printed height and measures a size spread of 2.0815%.

## Calibration: the size power on an icon set

The test uses four solid shapes from Bootstrap Icons in `fixtures/icons/` (MIT license, in the same folder). The square is the keyline anchor at 16px. Icon keyline grids let a circle, a diamond, and a star grow past the square, to compare their heuristic sizes.

```
node scripts/optical.mjs equalize fixtures/icons/{square,circle,diamond,star}-fill.svg --height 16 --target fixtures/icons/square-fill.svg --grow
node scripts/optical.mjs equalize fixtures/icons/{square,circle,diamond,star}-fill.svg --height 16 --target fixtures/icons/square-fill.svg --grow --strength 1
```

| shape | correction at power 0.5 | correction at power 1 |
|---|---|---|
| circle | ×1.059 | ×1.121 |
| diamond | ×1.146 | ×1.313 |
| star | ×1.173 | ×1.376 |

The power 0.5 grows the three shapes by 6%, 15%, and 17%. The power 1 grows them by 12%, 31%, and 38%, about twice as much. The choice between the two is a visual judgment, and the numbers alone do not settle it. To see both, render each row and compare them side by side:

```
node scripts/optical.mjs strip fixtures/icons/{square,circle,diamond,star}-fill.svg --out icons-half.png --height 64 --target fixtures/icons/square-fill.svg --grow
node scripts/optical.mjs strip fixtures/icons/{square,circle,diamond,star}-fill.svg --out icons-full.png --height 64 --target fixtures/icons/square-fill.svg --grow --strength 1
```

## Validation on held-out artwork

The earlier report claimed results for connector logos and Lucide icons.
Their exact manifest, artwork, licenses, runner, and raw outputs were not archived in this repository.
Those historical counts cannot be reproduced, so they are withdrawn as validation evidence.
Do not reconstruct or invent their results from the summary.

The shipped manifest in `fixtures/validation/manifest.json` distinguishes this missing corpus from a reproducible replacement set.
The replacement uses bell, hexagon, cloud, moon, flag, bookmark, chat, lightning, shield, and umbrella.
These shapes were outside logo tuning, demo artwork, and the four-shape size calibration.
Heart is excluded because the demo already uses it.
The manifest records Bootstrap Icons v1.11.3 source URLs and the MIT license URL.
The archived license in `fixtures/icons/LICENSE` matches that upstream release.
It is not the original held-out corpus and is not independent perceptual validation.
Run `cd scripts && npm run validate` to regenerate `fixtures/validation/recorded.json`.
The recorded run passes 10 of 10 shapes at the 1% gate.
The maximum off-center reading is 6.678654% before placement and 0.177497% afterward.
These values come from `cd scripts && npm run validate`; raw readings and artwork hashes are in `recorded.json`.
Placement and scoring share the same formula. Passing gates therefore checks numerical consistency and is circular for perception.

Use [KIT.md](KIT.md) for independent blind preference testing.
No participant results are claimed or supplied.

## Cases in the write-up

Each case is a section of [the write-up](https://kairevicius.github.io/skills/optical-balance/write-up.html), with its measured values in the figures and the text:

| case | what it shows |
|---|---|
| a two-tone mark on a tile (Amazon) | luma + OKLab chroma contrast gives the smile mass and extent influence |
| the same mark in dark mode | the background affects weights; each theme is measured against its actual plate |
| when not to discount (PayPal) | above 1/3 in either luma or colour contrast, faint ink is a second tone and keeps its full weight |
| icons in round buttons | a play icon moves right, an arrow moves left |
| a caps label in a pill | capitals sit high in the em box; letter-spacing adds a trailing gap |
| initials in an avatar disc | each letter needs its own offset |
| the Vercel mark in a disc | a shipped mark, corrected inside its disc container |
| an icon beside a label | less padding on the icon side |
| a symbol beside a wordmark (Slack, Airbnb, Shopify) | shipped lockups align visual centers, or follow a brand rule |
| a logo strip | equal perceived size, with the size spread before and after |
| cropping a portrait | the crop centers on contrast; subject identity requires inspection |

## Prior art

Designers already make these corrections by eye. The skill measures them. Cite these sources when someone asks if the correction is a known practice.

- Jakub Krehel, "Details that make interfaces feel better" (jakub.kr/writing/details-that-make-interfaces-feel-better): align optically, not geometrically; give the icon side of a button slightly less padding; fix icon shapes in the SVG itself.
- index.how/to/articulate, "Optical centre": a play button centered by coordinates looks left-heavy, and a nudge to the right fixes it.
- Refactoring UI (Wathan and Schoger), "Balance weight and contrast": bold text looks emphasized because it covers more surface, and icons look heavy for the same reason. Surface times contrast is the size weight of this skill.
- Helena Zhang, "Advanced icon design: dots" (minoraxis.medium.com): a dot must be slightly larger than the stroke weight to look balanced. It is the same kind of correction, at the level of a glyph.

## History

The method started in September 2026 on a pipeline that bakes company logos into square tiles. The Amazon wordmark looked too high on its white tile, although the bake used alpha-centroid centering. The accent discount came first. The 1/3 limit came next, when the two PayPal blues moved off center under the discount. The size rule came last, when a logo strip at equal height looked uneven. In October 2026, cold-agent tests and the held-out validation above added the input warnings, `place`, `check`, and the size correction in `strip`. A second cold round made `strip` render each whole file as it ships. Its earlier check on cropped copies passed a row that measured 3–4% as placed.


## Colour review: main, first pass, final

Run `node sites/optical-balance/colour-test.mjs` for the final snapshots.
The comparison runner is archived in `/workspace/codex/logs/ob-colour`; run `node comparison.mjs` there.
Each pair below is horizontal and vertical translation, as percentages of the whole source image box on white.
These source measurements differ from the rendered Amazon placement tests.

| Logo | main x%, y% | first pass x%, y% | final x%, y% |
|---|---:|---:|---:|
| amazon | +0.1096, +19.9014 | +0.3632, +7.5638 | +0.4398, +6.9406 |
| google | -0.5470, +0.9382 | -0.7672, +0.7823 | -0.5470, +0.9382 |
| stripe | +0.1449, -0.2278 | +0.1450, -0.2277 | +0.1449, -0.2278 |
| slack | -4.9320, -1.5781 | -2.7061, -1.9427 | -1.3317, -1.3889 |
| shopify | +3.5558, -2.0091 | -2.0172, -2.3020 | +3.5558, -2.0091 |
| apple | +0.5478, -4.4266 | +0.5478, -4.4266 | +0.5478, -4.4266 |
| mastercard | -0.0125, +3.3207 | +3.6532, +2.5837 | -0.0125, +3.3207 |
| netflix | +1.8745, +2.4974 | +1.8749, +2.4967 | +1.8751, +2.4973 |
| airbnb | -0.0481, -2.1200 | -0.0472, -2.1201 | -0.0481, -2.1200 |
| paypal | +3.7544, +3.2020 | +3.7544, +3.2020 | +3.7544, +3.2020 |

The first pass promoted Mastercard's yellow into strong ink, disabling the former two-tone guard.
Unequal colour weights then pulled a symmetric mark toward red, creating the positive horizontal correction.
Shopify's lighter green crossed the threshold before its darker green, producing the offset flip.
`hypot` restores their contrast ordering but alone still bypasses the two-tone guard.
The final guard checks both luma and colour shares, restoring Mastercard, Shopify, and PayPal to main's translations.
Amazon retains colour weighting because its smile remains a minority by either measure.
The snapshot test covers all ten sources, including PayPal outside the nine-logo strip.

Grey comparison covers every icon fixture on white and dark plates, plus both neutral Amazon fixtures.
Run the archived `grey-comparison.mjs`; its raw results are in `grey-comparison.json`.
All neutral-plate fixture offsets and held-out validation placement readings remain unchanged; `recorded.json` is untouched.
Mixed-grey marks in the transition band can change: the existing minority two-tone test now has extent x=42 instead of 34.
Its visual x changes from 35.750547 to 39.750547, reducing the horizontal correction by 4px.
This is intentional smoothing, not an unchanged-grey claim; the weight and size formulae remain identical for neutral greys.
Run `cd skills/optical-balance/scripts && npm test` for this explicit grey contract.

The colour placement tests use a 3px target plus one 0.25px raster step at default 4x rendering.
The worst colour-versus-mono vertical difference is 3.192px, for the lighter smile on cream.
Run `node comparison.mjs` from the archived review directory for every main, first-pass, and final placement reading.
These gates check numerical stability, not independent perceptual preference.

Visual inspection used a three-column contact sheet of all sources, with box guides and measured centre markers.
The final Mastercard marker returns to the symmetry axis; Shopify and PayPal return to their main markers.
Amazon's final marker includes the smile; Slack moves toward the coloured symbol as its chroma gains weight.
Google and Airbnb keep main's markers through the two-tone guard; Apple is unchanged.
Stripe and Netflix differ only slightly in raster edge weights.
The sheet is `/workspace/codex/logs/ob-colour/logo-visual.png`, generated by the archived `visual.mjs`.
Inspection found no extra horizontal symmetry defect. It does not replace independent human preference testing.

The same Vermeer frame input was also compared against main and the first pass.
Run the archived `frame-comparison.mjs`; raw values are in `frame-comparison.json`.
Its ink box is 1779×1496 on main and final, versus the erroneous 2780×1498 first-pass box.
The final crop starts at (1088,137), versus main's (1086,112), with the same 1348px side.
The vertical crop change is intentional colour weighting and extent smoothing after background exclusion; it is not a bit-identical photo result.
The three crops were inspected in `frame-visual.png`; the face and head remain intact, with a small upward subject shift.
Frame remains contrast-driven and cannot identify the person or apply a portrait composition rule.

`hypot` alone moves PayPal to (+5.1664%, +3.6045%) and Mastercard to (+2.9134%, +2.9145%).
The final two-share guard restores their main offsets, as the table shows.
Run the archived `metric-comparison.mjs` for the tone ordering, classification distances, and guard census.
For (5,4,20) on #0a0a08, classification is 0.0451; weighting is 0.1715.
Only classification is compared against the frame tolerance of 0.15.
The cached reader converts its background once per operation and caches chroma and luma by RGB.
No new performance measurement or speedup is claimed.
