# Evidence

Each result in this file comes with the command that reproduces it. Run the commands from the skill folder, after `npm install` in `scripts/`. The outputs below are from 2026-10-02. If a rerun gives a different output, the rerun is correct, and this file needs an update.

`docs/index.html` holds the full set of cases as figures. `node scripts/build-docs.mjs` rebuilds every figure and every number on that page from `docs/sources/`. This file does not copy those numbers, so they cannot drift here.

## Worked example: the Amazon wordmark on a tile

```
node scripts/optical.mjs tile docs/sources/amazon.svg --out amazon-tile.png
```

The script fits the trimmed mark into the art box of a 256px tile and measures it against white. Then it places the mark and measures the baked tile again:

```
artwork inside the art box (visual centering)
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

baked tile amazon-tile.png
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
```

How to read it:

- The extent center (y 17.5) uses the 35px-tall letters only, because the smile is faint ink at a 15% share. The ink box is 59px tall, because it includes the smile.
- The alpha centroid (y 22.3) counts the smile at full weight. It would leave the letters too high.
- The offset moves the mark down by 11.7px, which is 19.8% of its height.
- The baked tile measures 0.4px from its center: the residual is 0.3px on x and 0.2px on y. That passes the 1% gate.
- The faint-ink share rises from 15% to 31% in the baked tile. The tile is opaque, and its anti-aliased edges add faint ink. The share stays below 1/3, so the discount still applies. A mark with a share near 1/3 could switch.

## Worked example: a nine-logo strip

```
node scripts/optical.mjs equalize docs/sources/{amazon,google,stripe,slack,shopify,apple,mastercard,netflix,airbnb}.svg --height 40
```

```
target visual size 23.4px at row height 40px
file                equal-height  visual size  correction    render (w x h)
amazon.svg                132x40         40.7      x0.758        100.2x30.3
google.svg                121x40         26.3      x0.943        114.6x37.7
stripe.svg                 96x40         30.3      x0.878         84.5x35.1
slack.svg                 158x40         44.6      x0.724        114.5x29.0
shopify.svg               140x40         38.6      x0.778        109.1x31.1
apple.svg                  33x40         28.7      x0.902         29.4x36.1
mastercard.svg             52x40         28.5      x0.906         46.7x36.2
netflix.svg               148x40         41.7      x0.749        110.7x29.9
airbnb.svg                128x40         23.4      x1.000        128.0x40.0
```

How to read it:

- At equal height, Slack, Netflix, and Amazon have the largest visual sizes. Airbnb has the smallest, so it is the target, and it keeps its full height.
- Apple and Mastercard are compact marks with small visual sizes at equal height. They shrink less than the wide wordmarks.
- The strip in `docs/index.html` renders these sizes and measures each logo again. It reports the size spread before and after.

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

## Cases on the docs page

Each case is a section of `docs/index.html`, with its measured values in the figures and the text:

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

The method started in September 2026 on a company-logo tile bake in the Well platform. The Amazon wordmark looked too high on its white tile, although the bake used alpha-centroid centering. The accent discount came first. The 1/3 limit came next, when the two PayPal blues moved off center under the discount. The size rule came last, when a logo strip at equal height looked uneven.

That platform implementation is not on the platform's develop branch. This folder is the maintained implementation, and `scripts/lib.mjs` is its source of truth.
