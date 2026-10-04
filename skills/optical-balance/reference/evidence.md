# Evidence

Each result in this file comes with the command that reproduces it. Run the commands from the skill folder, after `npm install` in `scripts/`. The outputs below are from 2026-10-03. If a rerun gives a different output, the rerun is correct, and this file needs an update.

## Worked example: the Amazon wordmark on a tile

```
node scripts/optical.mjs tile docs/sources/amazon.svg --out amazon-tile.png
```

The script crops the mark to its ink, fits it into the art box of a 256px tile, and measures it against white. Then it places the mark and measures the baked tile again:

```
1. artwork cropped to its ink and fitted into the art box (visual centering): the offset to apply is here
image            195x59, background luminance 255.0
ink box          195x59 at 0,0
box center       97.5, 29.5
alpha centroid   95.4, 22.3
mass centroid    97.1, 18.2  (contrast-weighted, accent discounted)
extent center    97.5, 17.5  (box of the ink the eye reads, 195x35)
visual center    97.3, 17.8  (extent moved 0.5 of the way to mass)
faint-ink share  15% below contrast 0.6
visual size      59.8px (sqrt of contrast-weighted ink area)
perceived size   59.4px (geometric mean of visual size and ink height; equal across an equalized set)
offset to apply  x +0.2px (+0.1%), y +11.7px (+19.8%)  (positive y moves the element down)
css              transform: translate(0.11%, 19.78%)  (percent of this image's own box, as placed)
off center       19.78% of the shorter side (11.7px)  (to judge a rendered result, use check)

2. baked tile amazon-tile.png: its off center line is the gate
image            256x256, background luminance 255.0
ink box          195x59 at 31,110
box center       128.0, 128.0
alpha centroid   126.6, 132.4
mass centroid    128.2, 128.1  (contrast-weighted, accent discounted)
extent center    128.5, 127.5  (box of the ink the eye reads, 195x35)
visual center    128.3, 127.8  (extent moved 0.5 of the way to mass)
faint-ink share  31% below contrast 0.6
visual size      59.8px (sqrt of contrast-weighted ink area)
perceived size   59.4px (geometric mean of visual size and ink height; equal across an equalized set)
offset to apply  x -0.3px (-0.1%), y +0.2px (+0.1%)  (positive y moves the element down)
css              transform: translate(-0.13%, 0.08%)  (percent of this image's own box, as placed)
off center       0.15% of the shorter side (0.4px)  PASS at 1%
```

How to read it:

- The extent center (y 17.5) uses the 35px-tall letters only, because the smile is faint ink at a 15% share. The ink box is 59px tall, because it includes the smile.
- The alpha centroid (y 22.3) counts the smile at full weight. It would leave the letters too high.
- The offset moves the mark down by 11.7px, which is 19.8% of its height.
- The baked tile is 0.4px off center: 0.15% of the tile, which passes the 1% gate.
- The faint-ink share rises from 15% to 31% in the baked tile. The tile is opaque, and its anti-aliased edges add faint ink. The share stays below 1/3, so the discount still applies. A mark with a share near 1/3 could switch.

## Worked example: a nine-logo strip

```
node scripts/optical.mjs equalize docs/sources/{amazon,google,stripe,slack,shopify,apple,mastercard,netflix,airbnb}.svg --height 40
```

```
target visual size 23.4px at row height 40px
file                  equal-height  visual size  correction     ink (w x h)    file (w x h)
amazon.svg                  132x40         40.7      x0.758      100.2x30.3      100.4x30.3
google.svg                  121x40         26.3      x0.943      114.6x37.7      115.7x39.1
stripe.svg                   96x40         30.3      x0.878       84.5x35.1       84.5x35.1
slack.svg                   158x40         44.6      x0.724      114.5x29.0      115.0x29.3
shopify.svg                 140x40         38.6      x0.778      109.1x31.1      109.2x34.2
apple.svg                    33x40         28.7      x0.902       29.4x36.1       29.4x36.1
mastercard.svg               52x40         28.5      x0.906       46.7x36.2       46.7x36.2
netflix.svg                 148x40         41.7      x0.749      110.7x29.9      110.7x29.9
airbnb.svg                  128x40         23.4      x1.000      128.0x40.0      128.0x40.0
ink: the visible artwork at its new size. file: the whole file at the same scale, padding included; use it to size an <img> of the file as it is.
```

How to read it:

- At equal height, Slack, Netflix, and Amazon have the largest visual sizes. Airbnb has the smallest, so it is the target, and it keeps its full height.
- Apple and Mastercard are compact marks with small visual sizes at equal height. They shrink less than the wide wordmarks.
- The `file` column is larger than the `ink` column where the SVG has padding, as Google and Shopify do. Use it to size an `<img>` of the file.
- `node scripts/optical.mjs strip <same files> --out strip.png --height 40` renders each file at its printed height and measures a size spread of 0.73%.

## Calibration: the size power on an icon set

The test uses four solid shapes from Bootstrap Icons in `docs/sources/icons/` (MIT license, in the same folder). The square is the keyline anchor at 16px. Icon keyline grids let a circle, a diamond, and a star grow past the square, so that all four look equal.

```
node scripts/optical.mjs equalize docs/sources/icons/{square,circle,diamond,star}-fill.svg --height 16 --target docs/sources/icons/square-fill.svg --grow
node scripts/optical.mjs equalize docs/sources/icons/{square,circle,diamond,star}-fill.svg --height 16 --target docs/sources/icons/square-fill.svg --grow --strength 1
```

| shape | correction at power 0.5 | correction at power 1 |
|---|---|---|
| circle | ×1.059 | ×1.121 |
| diamond | ×1.146 | ×1.313 |
| star | ×1.173 | ×1.376 |

The power 0.5 grows the three shapes by 6%, 15%, and 17%. The power 1 grows them by 12%, 31%, and 38%, about twice as much. The choice between the two is a visual judgment, and the numbers alone do not settle it. To see both, render each row and compare them side by side:

```
node scripts/optical.mjs strip docs/sources/icons/{square,circle,diamond,star}-fill.svg --out icons-half.png --height 64 --target docs/sources/icons/square-fill.svg --grow
node scripts/optical.mjs strip docs/sources/icons/{square,circle,diamond,star}-fill.svg --out icons-full.png --height 64 --target docs/sources/icons/square-fill.svg --grow --strength 1
```

## Validation on held-out artwork

The method was tuned on the logos in `docs/sources`. On 2026-10-03 it was tested on artwork it had never seen. The test placed each artwork by its own box, as a layout does, and by the skill's procedure, then measured both results.

| set | artwork | geometric, above 1% off center | optical, above 1% off center | largest optical residual |
|---|---|---|---|---|
| connector logos, 48px PNGs with transparency, in a 96px tile | 50 | 24 | 0 | 0.53% |
| Lucide stroke icons, white on a dark round button | 24 | 9 | 0 | 0.25% |

Visual inspection of the 24 largest logo corrections showed the expected direction in each case. Heavy bases move up, top-heavy marks move down, and arrows move toward their tail. Lucide draws its play icon already shifted right inside its frame. The skill measures that frame-centered play icon at 0.08% off center, which agrees with the designers' hand placement.

Three agents also tested the skill cold, with only this folder and a realistic request: logo tiles, a logo wall, and a play button. Their reports found the failures that the current version fixes:

- trim against the corner pixel;
- silent zeros for a white icon and for an opaque backdrop;
- no command to verify a CSS offset;
- unclear gates.

`scripts/test.mjs` keeps each of those fixed.

## Cases in the write-up

Each case is a section of `docs/write-up.html`, with its measured values in the figures and the text:

| case | what it shows |
|---|---|
| a two-tone mark on a tile (Amazon) | contrast squared and the strong-ink extent put the letters on the center line |
| the same mark in dark mode | the background decides which ink is faint, so each theme has its own offset |
| when not to discount (PayPal) | above 1/3, faint ink is a second tone and keeps its full weight |
| icons in round buttons | a play icon moves right, an arrow moves left |
| a caps label in a pill | capitals sit high in the em box; letter-spacing adds a trailing gap |
| initials in an avatar disc | each letter needs its own offset |
| the Vercel mark in a disc | a shipped mark, corrected inside its disc container |
| an icon beside a label | less padding on the icon side |
| a symbol beside a wordmark (Slack, Airbnb, Shopify) | shipped lockups align visual centers, or follow a brand rule |
| a logo strip | equal perceived size, with the size spread before and after |
| cropping a portrait | the crop centers on the visual center of the subject |

## Prior art

Designers already make these corrections by eye. The skill measures them. Cite these sources when someone asks if the correction is a known practice.

- Jakub Krehel, "Details that make interfaces feel better" (jakub.kr/writing/details-that-make-interfaces-feel-better): align optically, not geometrically; give the icon side of a button slightly less padding; fix icon shapes in the SVG itself.
- index.how/to/articulate, "Optical centre": a play button centered by coordinates looks left-heavy, and a nudge to the right fixes it.
- Refactoring UI (Wathan and Schoger), "Balance weight and contrast": bold text looks emphasized because it covers more surface, and icons look heavy for the same reason. Surface times contrast is the size weight of this skill.
- Helena Zhang, "Advanced icon design: dots" (minoraxis.medium.com): a dot must be slightly larger than the stroke weight to look balanced. It is the same kind of correction, at the level of a glyph.

## History

The method started in September 2026 on a pipeline that bakes company logos into square tiles. The Amazon wordmark looked too high on its white tile, although the bake used alpha-centroid centering. The accent discount came first. The 1/3 limit came next, when the two PayPal blues moved off center under the discount. The size rule came last, when a logo strip at equal height looked uneven. In October 2026, cold-agent tests and the held-out validation above added the input warnings, `place`, `check`, and the size correction in `strip`. A second cold round made `strip` render each whole file as it ships. Its earlier check on cropped copies passed a row that measured 3–4% as placed.
