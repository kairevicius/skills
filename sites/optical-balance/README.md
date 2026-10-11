# optical-balance site

The landing page, the write-up, and the demo for the [optical-balance skill](../../skills/optical-balance/SKILL.md). Every figure and number is a measurement made by the skill's own code at build time.

```bash
cd skills/optical-balance/scripts && npm ci   # once: the build uses the skill's sharp
cd ../../.. && node sites/optical-balance/build-docs.mjs            # writes sites/optical-balance/dist
node sites/optical-balance/build-docs.mjs --inline                  # the same pages with every figure embedded
```

`sources/` holds the logos and the portrait that the figures measure. They stay out of the skill folder, so the installer does not copy them.


After building, run `node sites/optical-balance/colour-test.mjs` for the ten colour-logo snapshots.
Run `node sites/optical-balance/browser-test.mjs` for the landing page, write-up images, and demo controls.
The browser uses `OPTICAL_CHROMIUM` when set, or Playwright's installed Chromium.
The Pages workflow runs both checks.
