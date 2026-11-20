# Evidence

Each result in this file comes with the command that reproduces it. Run the commands from the skill folder, after `npm ci` in `scripts/`. The logo examples use files from the repository's `sites/optical-balance/sources`, so clone the repository to rerun them. The worked examples, the calibration, and the validation were rerun in November 2026 with sharp 0.35.5. The colour review at the end names the figures that cannot be rerun here. If a rerun gives a different output, the rerun is correct, and this file needs an update.

## Worked example: the Amazon wordmark on a tile

```
node scripts/optical.mjs tile ../../sites/optical-balance/sources/amazon.svg --out amazon-tile.png
```

The script crops the mark to its ink, fits it into the art box of a 256px tile, and measures it against white. Then it places the mark and measures the baked tile again:

```
1. artwork cropped to its ink and fitted into the art box (visual centering). The bake applies this offset; for a component, use place instead.
image            195x59, background #ffffff (luminance 255.0)
ink box          195x59 at 0,0
box center       97.5, 29.5
alpha centroid   95.4, 22.2
mass centroid    95.8, 21.3  (contrast-weighted, accent discounted)
extent center    97.5, 29.5  (box of the ink the eye reads, 195x59)
visual center    96.6, 25.4  (extent moved 0.5 of the way to mass)
faint-ink share  colour 0%, luma 15% below contrast 0.6
visual size      62.2px (sqrt of contrast-weighted ink area)
perceived size   60.6px (geometric mean of visual size and ink height; equal across an equalized set)
offset to apply  x +0.9px (+0.4%), y +4.1px (+6.9%)  (positive y moves the element down)
off center       7.10% of the shorter side (4.2px)  (to judge a rendered result, use check)

2. baked tile amazon-tile.png: its off center line is the gate
image            256x256, background #ffffff (luminance 255.0)
ink box          195x59 at 31,103
box center       128.0, 128.0
alpha centroid   126.7, 125.4
mass centroid    126.8, 124.4  (contrast-weighted, accent discounted)
extent center    128.5, 132.5  (box of the ink the eye reads, 195x59)
visual center    127.7, 128.4  (extent moved 0.5 of the way to mass)
faint-ink share  colour 19%, luma 31% below contrast 0.6
visual size      62.4px (sqrt of contrast-weighted ink area)
perceived size   60.7px (geometric mean of visual size and ink height; equal across an equalized set)
offset to apply  x +0.3px (+0.1%), y -0.4px (-0.2%)  (positive y moves the element down)
off center       0.21% of the shorter side (0.5px)  PASS at 1%
```

OKLab chroma now makes the smile strong ink, so the extent includes the whole mark.
The smaller correction replaces the historical luminance-only placement.
The baked tile reads more faint ink than the artwork, because its anti-aliased edges blend into the plate.

## Worked example: a nine-logo strip

```
node scripts/optical.mjs equalize ../../sites/optical-balance/sources/{amazon,google,stripe,slack,shopify,apple,mastercard,netflix,airbnb}.svg --height 40
```

```
target perceived size 33.9px at row height 40px
file                  equal-height  visual size  correction     ink (w x h)    file (w x h)
amazon.svg                  132x40         42.4      x0.823      108.9x32.9      109.1x32.9
google.svg                  121x40         35.5      x0.900      109.3x36.0      110.3x37.3
stripe.svg                   96x40         40.5      x0.843       81.0x33.7       81.0x33.7
slack.svg                   158x40         47.4      x0.779      123.0x31.1      123.6x31.5
shopify.svg                 140x40         41.7      x0.830      116.3x33.2      116.4x36.5
apple.svg                    33x40         28.7      x1.000       32.6x40.0       32.6x40.0
mastercard.svg               52x40         36.3      x0.890       45.8x35.6       45.8x35.6
netflix.svg                 148x40         51.4      x0.748      110.5x29.9      110.5x29.9
airbnb.svg                  128x40         33.4      x0.928      118.8x37.1      118.8x37.1
ink: the visible artwork at its new size. file: the whole file at the same scale, padding included; use it to size an <img> of the file as it is.
These are the computed sizes. strip renders them, corrects the rounding, and checks the result.
```

How to read it:

- At equal height, Netflix, Slack, and Amazon have the largest visual sizes. Apple sets the smallest perceived-size target and keeps its height.
- Apple and Mastercard are compact marks with small visual sizes at equal height. They shrink less than the wide wordmarks.
- The `file` column is larger than the `ink` column where the SVG has padding, as Google and Shopify do. Use it to size an `<img>` of the file.
- `node scripts/optical.mjs strip <same files> --out strip.png --height 40 --json` renders each file at 2x, the default scale. It reports a `spread` of 1.3697.

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

The power 0.5 grows the three shapes by 6%, 15%, and 17%. The power 1 grows them by 12%, 31%, and 38%, about twice as much. The choice between the two is a visual judgment, and the numbers alone do not settle it. To see both, render each row and compare them side by side. `strip` renders at 2x unless you pass `--scale`:

```
node scripts/optical.mjs strip fixtures/icons/{square,circle,diamond,star}-fill.svg --out icons-half.png --height 64 --target fixtures/icons/square-fill.svg --grow
node scripts/optical.mjs strip fixtures/icons/{square,circle,diamond,star}-fill.svg --out icons-full.png --height 64 --target fixtures/icons/square-fill.svg --grow --strength 1
```

The first row prints a size spread of 0.44% and passes the 3% gate.
The second row grows the star to 94px against the square's 64px.
It prints a size spread of 17.97% and exits with code 1.
That is expected: the gate is on perceived size, which only the default power equalizes.

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

Use the repository file `docs/optical-balance/KIT.md` for independent blind preference testing.
It is not part of the installed skill and is not loaded during measurement.
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

Run `node sites/optical-balance/colour-test.mjs` from the repository root for the final column.
It checks all ten logos against `sites/optical-balance/colour-snapshots.json`.
The review also used comparison scripts, their JSON outputs, and two contact sheets.
Those files stayed in the review workspace and are not in this repository.
Every figure marked *recorded* below comes from that run and cannot be rerun here.
The main and first-pass columns are recorded.
Each pair below is horizontal and vertical translation, as percentages of the whole source image box on white.
These source measurements differ from the rendered Amazon placement tests.

| Logo | main x%, y% (recorded) | first pass x%, y% (recorded) | final x%, y% |
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
The review recorded that all neutral-plate fixture offsets stayed unchanged.
The held-out placement readings also stayed unchanged: `npm run validate` in `scripts/` leaves `recorded.json` untouched.
Mixed-grey marks in the transition band can change: the minority two-tone test now has extent x=42.
The recorded main value was 34, with visual x moving from 35.750547 to 39.750547.
This is intentional smoothing, not an unchanged-grey claim; the weight and size formulae remain identical for neutral greys.
Run `cd skills/optical-balance/scripts && npm test` for this explicit grey contract.

The colour placement tests use a 3px target plus one 0.25px raster step at default 4x rendering.
`npm test` in `scripts/` asserts that 3.25px limit for two orange smiles on white and cream.
The recorded worst colour-versus-mono vertical difference was 3.192px, for the lighter smile on cream.
These gates check numerical stability, not independent perceptual preference.

Visual inspection used a recorded three-column contact sheet of all sources, with box guides and measured centre markers.
The final Mastercard marker returns to the symmetry axis; Shopify and PayPal return to their main markers.
Amazon's final marker includes the smile; Slack moves toward the coloured symbol as its chroma gains weight.
Google and Airbnb keep main's markers through the two-tone guard; Apple is unchanged.
Stripe and Netflix differ only slightly in raster edge weights.
The sheet is not in this repository, so these observations are recorded.
Inspection found no extra horizontal symmetry defect. It does not replace independent human preference testing.

The same Vermeer frame input was also compared against main and the first pass.
The input was the widened photo that the site build makes, not the source file. These figures are recorded.
Its ink box was 1779×1496 on main and final, versus the erroneous 2780×1498 first-pass box.
The final crop started at (1088,137), versus main's (1086,112), with the same 1348px side.
The vertical crop change is intentional colour weighting and extent smoothing after background exclusion; it is not a bit-identical photo result.
The three crops were inspected on a recorded contact sheet; the face and head remain intact, with a small upward subject shift.
Frame remains contrast-driven and cannot identify the person or apply a portrait composition rule.

The recorded `hypot`-alone run moved PayPal to (+5.1664%, +3.6045%) and Mastercard to (+2.9134%, +2.9145%).
The final two-share guard restores their main offsets, as the table shows.
The tone ordering, classification distances, and guard census are recorded.
For (5,4,20) on #0a0a08, classification is 0.0451 and weighting is 0.1715.
From `scripts/`, this command prints both:

```
node -e "import('./lib.mjs').then(l => console.log(l.inkContrast(5,4,20,{r:10,g:10,b:8}).toFixed(4), l.perceptualContrast(5,4,20,{r:10,g:10,b:8}).toFixed(4)))"
```

Only classification is compared against the frame tolerance of 0.15.
The cached reader converts its background once per operation and caches chroma and luma by RGB.
No new performance measurement or speedup is claimed.
