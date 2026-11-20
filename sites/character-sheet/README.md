# Character sheet skill

An agent skill that turns one or more photos of a real person into a character sheet: 13 separate studio views
(6 of the head, 3 of the full body, 4 close details) with the same face, clothes and light, plus a WebP export for a
film's cast.

## What is here

- `examples/`: sheets of nine invented people, each made from one hard photo (dark bar, sunglasses, close selfie, black-and-white film, group, far away, backlit hijab, tattoos, video call). `all-9-sheets.jpg` shows them together; each folder holds the 13 WebP views, the contact sheet and the `cast.json` export. `PHOTO-CONDITIONS.md` in the skill describes each case.
- The skill itself is in [`skills/character-sheet/`](../../skills/character-sheet/SKILL.md).

## Install

```bash
npx skills@latest add kairevicius/skills --skill character-sheet
```

The skill is user-invoked: start it by typing its name in your agent.

## Needs

- `uv` (https://docs.astral.sh/uv/). The scripts declare their own Python packages, and uv installs them on the
  first run: Pillow for the sheet, dlib for the face score.
- A Gemini API key in `GOOGLE_GENERATIVE_AI_API_KEY`. Every view is a paid call to `gemini-3-pro-image`; the script
  does a dry run first and refuses more than 30 images per run unless you raise `--max-images`.

Photos and generated images go to `~/Documents/character-sheets/<name>/`. Set `CHARACTER_SHEET_DIR` to
change it. Keep real people's photos out of any repository.

Some steps in `SKILL.md` name files in the Well repository (the consent list, the YC video production, the
character reference standard). They apply only inside that repository; the skill runs without them.
