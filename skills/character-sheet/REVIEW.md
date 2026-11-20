# Character sheet review

Review each take against the real photos, not against memory. A take passes only when every line of the checklist holds.

## The views

Left and right always mean the edges of the image, never the person's own left or right.

| View | Label | Frame | Passes when |
|---|---|---|---|
| `head-front` | Front | 4:5 | face square to the lens, eyes to the lens |
| `head-34-left` | 3/4 left | 4:5 | face turned about 45 degrees toward the left edge, both eyes visible |
| `head-34-right` | 3/4 right | 4:5 | the same toward the right edge |
| `head-profile-left` | Profile left | 4:5 | the nose points to the left edge and the far eye is hidden (only its lashes may show) |
| `head-profile-right` | Profile right | 4:5 | the same toward the right edge (made as the mirror of a left profile) |
| `head-above` | Slightly from above | 4:5 | camera clearly above: the crown shows, the chin looks smaller, the eyes look up |
| `body-front` | Body front | 2:3 | head to toe, both shoes, space above and below, no floor seam |
| `body-side` | Body side | 2:3 | strict side view, facing the right edge, the far arm and leg hidden |
| `body-back` | Body back | 2:3 | back to the lens, the nape and the collar visible |
| `detail-eyes` | Eyes | 16:9 | the eyes and brows fill the frame |
| `detail-skin` | Skin and mouth | 4:5 | from under the eyes to the chin, real skin texture |
| `detail-hands` | Hands | 4:5 | both hands relaxed on a table edge, five fingers each, no object |
| `detail-neckline` | Neckline | 4:5 | from the lips to mid-chest, the whole collar of the top |

## Checklist for each take

1. **Same person.** Face shape, eyes (shape, colour, spacing), brows, nose, lips, chin, ears, hairline, hair length and texture, skin tone and age match the real photos. A face that looks like a sibling fails.
2. **Right view.** The angle and the direction match the table. The model sometimes returns a different view (a full body for a close-up): that take fails.
3. **One frame.** One photo of one view: no collage, no split frame, no second person, no mirror.
4. **Same clothes.** The garments of `wardrobe`, the same colour and collar in every view. No logo. No watch, ring, jewellery or glasses unless `accessories` lists them. Clothes in every view, the close-ups too.
5. **Same look.** The same flat light grey and the same soft frontal light as the other picks. No colour cast, no HDR, no dramatic shadow, nothing of the photo's scene behind the person. `contact` prints "backdrop off" or "backdrop not plain" for a head or body tile that fails this.
6. **Marks on the right side.** Each entry of `marks` shows on its own side and only where that side faces the lens: a left-side tattoo is on the image's right in a front view, on its left in a back view, and absent from the right profile and the body side.
7. **Real body.** Five fingers on each hand, natural joints, natural proportions (the head about one eighth of the height in a full body).
8. **Real skin.** Pores and fine lines stay. No airbrushed or plastic skin, and no added marks that the real photos do not show.

## Whole-set check

On `contact.jpg`: the 13 picks show one person, one background, one light. The head views have about the same face size. The full bodies have about the same height in frame.

## Known failures and their fixes

Evidence: the runs of 2026-10-31 on one real person (one front photo, 79 takes) and on nine invented people photographed under hard conditions (`PHOTO-CONDITIONS.md`; about 300 takes), and the YC founder video sheets of 2026-10-28 (four real photos each). The final workflow passed 111 of 117 views on the first take: 98 of 99 for the eleven views that are not profiles.

| Failure | Cause | Fix | Evidence |
|---|---|---|---|
| A collage of several views in a close-up | "like a film casting sheet" in the look line | `LOOK` asks for one single photograph of one view | 1 of 26 takes before, none in about 300 after |
| A full body instead of the eyes close-up | the close-up prompt named trousers and shoes | each view names only the facts and garments in its frame (`facts`, `wears`) | 1 of 26 before, none after |
| The skin close-up widens and shows bare shoulders | the view named no garment | the crop edges are named and the top is worn | 3 of 9 cases before, 0 of 15 takes after |
| The background drifts between warm, neutral and bluish grey | model habit | `contact` and `export` match each head and body tile to the sheet's median grey; a tile still more than 20 levels off is flagged | after the match, 12 of 109 head and body tiles were still more than 12 levels off; all were the tiles that look off by eye |
| The photo's scene shows behind the person | the reference photo leaks through | `contact` flags a tile whose edges are not plain backdrop; re-roll it | 2 tiles (steps behind a profile, a car roof behind a selfie profile) |
| "Slightly from above" drawn at eye level | "30 cm above eye level" was too weak | the high-angle wording: crown visible, chin smaller, eyes up | 0 of 2 before, 9 of 9 cases after |
| The body side faces right when asked for left | a strong model habit | `body-side` asks for the right-facing view | 4 of 4 faced right; strict in 18 of 18 after |
| The right profile turns only 60 to 75 degrees | the model's right-facing profile is weak | made as the mirror of a left profile, from flipped photos | 5 of 13 takes failed before, 10 of 10 strict in the first test after |
| A profile turns only 50 to 80 degrees with the front anchor | the front view pulls the head toward the lens | profiles get no anchor | 4 of 8 anchored takes failed |
| Some faces stay at 70 to 80 degrees in profile | per face: the close selfie and the sunglasses photo, both at an angle | two takes at least (`min_takes`), then a pick; after three rounds, ask for a real side photo. A plaster-head pose image, shoulder wording and a reframe of the body side did not help (1 of 10, 1 of 8, 1 of 4) | 7 of 9 people strict within two takes |
| The front loses a beard the other views keep | each view read the hard photo on its own | the front is made and picked first, then anchors every other view but the profiles | sunglasses: the front lost it in round 1; every version 2 tile keeps it |
| A one-sided tattoo shows on the side in view | the model draws a mark wherever it looks | `marks` lists each mark with its side; each view says where it shows or that it is hidden | 2 of 13 tattoo views wrong before, 0 of 25 after |
| A piercing shows doubled or misplaced | the description missed it, so the model copied it from the photo | zoom into the face before describing; unlisted piercings are banned | 1 of 9 cases |
| The same photo was added twice | a second `init` appended it again | `init` records each source photo and crop and skips a known one | 1 of 9 cases |
| No image for a view that hides the face | the prompt asked for "the same face" | views without a face use `SAME_BODY` | website tile generator |
| A watch or jewellery appears | nothing banned it | an empty `accessories` list adds the ban line | YC sheet v4 |
| Profiles deepen the hairline corners | inferred from a front photo only | a person fix in `fixes`, or a real profile photo | the one-photo run, profiles |
| A hard floor seam or a backdrop edge behind a full body | random | `contact` flags it; pick another take | 2 body-front takes |
