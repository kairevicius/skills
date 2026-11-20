---
name: character-sheet
description: "Character sheet of a real person from their photos: 13 studio views, a film cast export. Use on character sheet, cast sheet, turnaround."
disable-model-invocation: true
---

# Character sheet

This skill makes a character sheet of one real person from that person's own photos: 13 separate studio photos with the same face, the same clothes and the same light. Six views show the head, three show the full body and four show details. The shape is the cast of the YC founder video (`cast[].sheet` in `apps/website/src/app/design/video/productions/yc-founder-video.json`), so a film can use the sheet as it is. Steps that name files under `apps/` or `scripts/image-gen/` apply only inside the Well repository; the skill runs without them.

The views are separate images, never one composite: in a composite the faces are too small for a generator to copy (`apps/website/docs/character-reference-standard.md`, step 4).

Do not use this skill for:

- an invented person on the website. Use `apps/website/docs/character-reference-standard.md` and `apps/website/scripts/generate-character-tiles.mjs`.
- the Higgsfield `character-sheet` workflow. It makes original characters only and refuses a real likeness.

## Rules

- **Consent.** Use only the photos of the person who asks, or of a team member who agreed. Never a celebrity or a person who did not agree. For a team member, read `OPT_OUT` and `CONSENT_PENDING` in `scripts/image-gen/founder-portraits/people.py` before any public use.
- **Outside the repository.** Personal photos and generated faces stay in the work folder `~/Documents/character-sheets/<slug>/` (`CHARACTER_SHEET_DIR`). Only an export that a pull request needs goes under `apps/assets/public/website/`.
- **Paid calls.** Every image is a paid Gemini call (`gemini-3-pro-image`). Do a dry run first. The script refuses a run above `--max-images` (default 30).
- **No retouch.** A tile that fails review gets a new take with a correction. Never edit a tile until it passes.

## Steps

Set `SKILL_ROOT` to the folder that holds this `SKILL.md`. The script is `$SKILL_ROOT/scripts/character_sheet.py`. Run it with `uv run <script> <command>`: uv installs Pillow on first use. The key is `GOOGLE_GENERATIVE_AI_API_KEY`. When the Bash tool's shell does not have it, prefix the command with `GOOGLE_GENERATIVE_AI_API_KEY=$(zsh -ic 'printenv GOOGLE_GENERATIVE_AI_API_KEY')`. Never print the key.

1. **Get the photos.** Any photo works: any format (JPEG, PNG, WebP, HEIC), any light, any angle, a selfie, a group photo, a screenshot. One photo that shows the face is enough to start. A sharper face, or a real three-quarter, profile or full-body photo, makes the matching views more exact: ask for one only when the person has it.
2. **Init.** `init <slug> --name <Name> --role "<role>" --photo <path>[@x0,y0,x1,y1] [...]`.
   - Crop each photo to the person with `@x0,y0,x1,y1` (fractions of the width and height) when other people are in it or the person is small in the frame. Read the crop in `refs/` before you go on.
   - Add `--bw` when every photo is black and white and nobody gives the colours. Otherwise the sheet is in colour, as in the final YC video.
3. **Describe the person.** Read each photo, then zoom into the face (crop it large and read the crop): small piercings, earrings, moles and scars are easy to miss, and the model copies what it sees whether or not you list it. Then fill `character.json`. `PHOTO-CONDITIONS.md` has a worked example for each hard photo.
   - `identity`: one short fact per key (age, build, skin, face, hair, eyes, facial_hair, marks), as the person looks under neutral light: a face under orange bar light is not orange. `identity.marks` holds only what shows on both sides, such as freckles or wrinkles.
   - `marks`: a list with one entry for each thing on one side only (a tattoo, a mole, a scar, a single earring, a side parting): `{"what": "a black-ink compass tattoo on the side of the neck", "side": "left"}`. `side` is the person's own `left` or `right`, or `centre`. Each view then shows or hides each mark by name; never write a side into a text field.
   - A value that no photo shows is assumed from a reliable basis: write it with "(assumed: <why>)" in the field and add it to `assumed`. Never leave a required field empty.
   - `accessories`: what the person always wears: prescription glasses, earrings, piercings. An empty list bans a watch, rings and glasses in every prompt.
   - `wardrobe.top`, `wardrobe.bottom`, `wardrobe.shoes`: the clothes of the photos, plain: describe a printed T-shirt without its print. A dress goes in `top` and leaves `bottom` empty. Choose a plain matching garment for a part that no photo shows, and add it to `assumed`.
   - Keep what belongs to the person: prescription glasses, a hijab or other religious covering (in `wardrobe.top`, with `hair` "always covered"), tattoos, scars, piercings. Remove what belongs to the moment: sunglasses, a cap or beanie, held objects, logos.
   - `conditions`: every one that applies, from this fixed list. Each adds a tested correction to every prompt.

     | Condition | When |
     |---|---|
     | `wide-angle-selfie` | a close selfie: big nose, hidden ears |
     | `colour-cast` | orange, blue or green light on the face |
     | `black-and-white` | black-and-white photos for a colour sheet |
     | `low-quality` | a small, dark, noisy, blurred or compressed face |
     | `eyes-hidden` | sunglasses or deep shadow over the eyes |
     | `headwear-removed` | a cap, hat or beanie that the sheet leaves out |
     | `not-at-rest` | a smile, a laugh or a squint |
     | `props` | the person holds something |
     | `other-people` | anyone else shows in a crop |

   - For a beard or moustache, set `labels.detail-skin` to "Beard and skin" or "Moustache and skin".
4. **Dry run.** `gen <slug> --dry-run`. Read one prompt in full.
5. **The front first.** `gen <slug> head-front --takes 2`, then `contact <slug> --takes` and read `takes-head.jpg`. Pick the take that looks most like the real photos: `pick <slug> head-front=<take>`. From now on every other view also receives this front as the anchor of the face, so a hard photo cannot pull the views to different faces.
6. **The other views.** `gen <slug> --takes 1` makes the 12 views that have no pick yet. The script makes two takes of each profile, sends the profiles without the anchor, and makes the right profile as the mirror image of a left profile from flipped photos.
7. **Review.** `contact <slug> --takes` writes one sheet for each group (`takes-head.jpg`, `takes-body.jpg`, `takes-details.jpg`). Read each sheet. Check every take against `REVIEW.md`, and zoom on a close candidate before you pick it. A tile the script prints as "backdrop off" or "backdrop not plain" fails the same look.
   - The eye misses a look-alike. `uv run $SKILL_ROOT/scripts/face_match.py --person <slug>=<real photo> <takes>` scores each take. Its verdicts ("close" under 0.45) are set for film frames, where the face is small and lit by the room. A sheet view is a studio close-up made straight from the photos, and every frame of a film copies its face, so hold it to a stricter bar: re-roll a head-front or three-quarter take that scores 0.35 or more (the tested sheet's views scored 0.12 to 0.29). The score does not judge a profile against a front photo: a correct profile scored 0.47 to 0.64. Judge a profile by eye against the picked front and three-quarter views.
8. **Pick and fix.** For each view, `pick <slug> <view>=<take>` the best take that passes. Then `gen <slug> --takes 2` makes new takes of only the views still without a pick. Before that, for a view where no take passed:
   - A defect of this person only (a hairline, a mark): add one correction sentence to `fixes.<view>` in `character.json`.
   - A defect that any person would get: fix the script (see "Improve the skill").
   - After three rounds without a pass, pick the best take and ask for a real photo of that angle. Some faces keep a profile at 70 to 80 degrees whatever the prompt; a real side photo fixes it.
9. **Check the whole set.** `contact <slug>` writes `contact.jpg`: the real photos, then the 13 picked views, each head and body tile matched to the sheet's backdrop grey. Read it: same person, same grey, same light, the same scale in each group. Send it to the person and ask for approval. On yes, set `status` to `locked`. A locked version refuses `gen` and `pick`; raise `version` for a new sheet, which starts with no picks.
10. **Export for a film** (only when asked): `export <slug> --dest apps/assets/public/website/films/<film>/cast --media-prefix films/<film>/cast`. The command writes one WebP under 500 KB for each view and prints the `cast` entry for `apps/website/src/app/design/video/productions/<film>.json`. It never exports the real photos, and it refuses a draft into a repository: lock the sheet first (step 9). Public use needs the person's consent to public use.

## Improve the skill

A correction that would help any person goes into the script, not into `fixes`: change the view's `shot`, its `facts` or `wears`, or the `LOOK` line. Then add a row to the failure table in `REVIEW.md` with the evidence: the takes that failed before the change and the takes that passed after it. A correction for one face stays in that person's `character.json`.

Report the result to the user with the number of paid images that the run used.
