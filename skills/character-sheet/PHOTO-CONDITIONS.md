# Hard photos: worked examples

Each row is a test photo of an invented person (2026-10-31) and how its `character.json` was filled. Use the row that is nearest to your photo. The result is the first take of the final workflow (front picked first, then the other twelve views); every case ended with a full sheet of 13 views.

| Photo | Crop | Conditions | What the description does | First take |
|---|---|---|---|---|
| Dim bar, orange light, noise, laughing, a wine glass, people behind | `@0.25,0.05,0.97,1` | `colour-cast`, `low-quality`, `not-at-rest`, `props`, `other-people` | Skin "dark brown", not the orange of the light. Gold hoops in `accessories`. Jeans and boots assumed. | 13 of 13 |
| Midday sun, cap, sunglasses, printed T-shirt, smiling | none | `eyes-hidden`, `headwear-removed`, `not-at-rest` | Eyes "dark brown (assumed: sunglasses hide them)". Hair "(assumed: the cap hides the top)". T-shirt described "no print". | 12 of 13; his profiles stayed near 75 degrees |
| Close car selfie, prescription glasses, big smile | none | `wide-angle-selfie`, `not-at-rest` | Glasses in `accessories` with "always on". | 11 of 13; her left profile stayed near 80 degrees |
| Black-and-white film, grain, three-quarter from one side | `@0.2,0.05,0.95,0.85` | `low-quality` | `--bw`: no colour is known. Eye and skin colour written as unknown. | 13 of 13 |
| Party photo, two people, she looks down at a phone, a dress | `@0.46,0,0.86,1` | `other-people`, `props`, `not-at-rest` | The dress in `top`, `bottom` empty. Eye colour assumed. Freckles in `identity.marks`; the nostril hoop (left) and stud (right) in `marks`, found only by zooming into the face. | 12 of 13 before the piercings were listed |
| Street, 15 m away, beanie, skateboard, tiny face | `@0.36,0.15,0.62,1.0` | `low-quality`, `headwear-removed`, `props`, `other-people` | Hair assumed. Shoes described without their brand. | 12 of 13 |
| Backlit office, hijab, round glasses, a laptop | none | `low-quality`, `props` | The hijab in `wardrobe.top`; `hair` "never visible: always fully covered by the navy hijab". | 12 of 13 |
| Low angle, seated, neck and arm tattoos | none | none | Each tattoo in `marks` with its side (`left`). Standing pose assumed. | 13 of 13, every tattoo on its side |
| Video-call screenshot, 480 px, blue light, compression | `@0.38,0.1,0.75,0.85` | `low-quality`, `colour-cast` | The script upscales the 178 px crop and warns. Eye colour assumed. | 13 of 13 |

## Rules these examples show

- Crop first, then describe: a description of the wrong person cannot be fixed by a prompt.
- Zoom into the face before you describe it: the model copies a piercing or a mole from the photo even when the description leaves it out.
- Describe the person under neutral light, never the light of the photo.
- Keep what belongs to the person; remove what belongs to the moment (`SKILL.md`, step 3).
- Mark every inferred value in its field with "(assumed: <why>)". The model treats an assumed value as a weaker hint and the reviewer knows what to check with the person.
- A photo of a head turned away from the lens, or a close selfie, can make the profiles stay short of 90 degrees: plan for re-rolls, or ask for a side photo.
