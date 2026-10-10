# Blind preference test kit

## Scope

It does ONE thing: prepares a blind comparison of the heuristic with box and mass placement.
It supplies no participant results.

## Hard rules

1. Keep `organizer-key.json` away from participants and facilitators who present stimuli.
2. Show equal-size images on one light background. Disable scaling differences between pairs.
3. Preserve ties and negative judgments. Never infer responses from the measurement gates.
4. Obtain consent before collecting participant identifiers. Use anonymous codes.

## Workflow

### Phase 1: Generate

Run `cd scripts && npm run kit -- /absolute/output/folder`.
The generator uses shipped MIT-licensed fixtures and randomizes each pair's left/right assignment.
Archive the generated key with the stimuli so the assignment can be recovered.

### Phase 2: Present

Shuffle pair order separately for each participant.
Ask: “Which placement looks more centered: left, right, or equal?”
Do not identify the method or show measurement scores.
Keep viewing distance, zoom, and display theme constant; record them with the session.

### Phase 3: Record

Use the generated `results.csv` template.
Leave unanswered cells empty. Record optional confidence and comments verbatim.
Select participant count and stopping rules before examining responses.

### Phase 4: Analyze

Decode assignments only after collection ends.
Report sample size, ties, preferences, uncertainty, and fixture-level disagreements.
Keep repeated judgments from one observer grouped in analysis.

## Decision points

Symmetric fixtures may produce ties. Keep them as controls.
The kit tests centering preference only. Sizing and photo-framing preferences need separate stimuli.

## Verification gates

Check that every pair uses the same canvas dimensions and light background.
Verify that each response maps to one archived key entry.
No measurement gate substitutes for a participant response.

## Known limits

These icons cannot establish general preference across logos, typefaces, photos, or themes.
The method remains a heuristic until independent evidence supports broader claims.

## Files

- `scripts/preference-kit.mjs`: stimuli and blank results generator.
- `fixtures/validation/manifest.json`: fixture identities and license.
- Generated `organizer-key.json`: concealed assignments.
- Generated `results.csv`: empty participant results template.
