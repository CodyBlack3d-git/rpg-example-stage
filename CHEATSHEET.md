# RPG Stage Cheatsheet

Quick reference for finding things in `src/Stage.tsx`. To use: open the file in VS Code, press `Ctrl+F`, paste a search snippet, and you'll land at the right section.

## Workflow Reminders

**Starting a Codespace session:**
```
git pull --no-rebase
nvm use 21.7.1
yarn dev
```
Open a *second* terminal for git commands — `yarn dev` blocks input.

**Saving and pushing:**
- `Ctrl+S` to save in editor (auto-save is off by default).
- Source Control sidebar → message → Commit → Sync Changes.
- If git complains about divergent branches, in a fresh terminal: `git pull --no-rebase`. Handle nano with `Ctrl+X`, `Y`, `Enter`.

**Testing:**
- Test runner: `localhost:5173`. Always test changes here first.
- Production: hard-refresh Chub with `Ctrl+Shift+R` after deploy completes.
- Check DevTools Console (`F12`) for runtime errors.

**Before deploying to Chub:** confirm `const DEV_MODE = false;` at the top of the file. The dev test button only shows when DEV_MODE is true.

---

## Adding Companion Content

### Add a new companion to the roster
**Search for:** `companionRoster: {[id: string]: Companion} = {`

The `companionRoster` object holds all roster companions. Copy the Niri entry as a template. Required fields:
- `id` (lowercase, no spaces)
- `name`, `mood`, `moodImages` (paths to GIFs in `public/characters/`)
- `description`, `isRoster: true`
- `abilities` (six D&D scores)
- `bondLevel: 0`, `bondProgress: 0`
- `socialUnlocks: []` (fill in later)
- `spellList: []` (fill in later)

After adding, also update `defaultActiveCompanions` if you want them to start in the party.

### Add a spell to a companion's spellList
**Search for:** `spellList: [` (then narrow to the right companion)

Each spell needs:
```typescript
{
    id: 'companion_spell_name',     // globally unique
    name: 'Display Name',
    description: 'What it does, in narrative voice.',
    seedCost: 1,
    bondRequirement: 0,             // bond level needed to unlock
    effectTags: ['heal']            // optional
}
```

### Add a social unlock to a companion
**Search for:** `socialUnlocks: [` (then narrow to the right companion)

Each unlock:
```typescript
{ bondLevel: 2, description: "Niri shares the name of her home village." }
```

The AI sees these in the prompt once bond reaches that level, and weaves them into narration.

### Change a companion's starting moods or images
**Search for:** the companion's `moodImages: {` block.

To add a new mood: add a key/value pair, then update `validMoods` in `formatStatsForPrompt`. Search for `const validMoods = [`.

---

## Adding Location Content

### Add a new known location
**Search for:** `knownLocations: {[id: string]: Location} = {`

Copy the tavern entry as a template. Required fields: `id`, `name`, `image` (path to PNG in `public/Locations/`), `description`, `isKnown: true`.

**Important:** filename case matters in production. `public/Locations/` must be capitalized exactly as referenced. Check on GitHub web UI after committing.

### Set the default starting location
**Search for:** `currentLocation: messageState?.currentLocation ?? knownLocations.`

Change `tavern` to whichever location id you want as the default for new chats.

---

## Tuning Game Mechanics

### Change starting player stats
**Search for:** `const defaultPlayer: PlayerStats = {`

Adjust HP, MP, level, XP, inventory, abilities, seeds, maxSeeds.

### Change bond level costs (how much progress per level)
**Search for:** `const BOND_LEVEL_COSTS: number[] =`

Array of 10 numbers — index 0 is cost to reach level 1. Total of all entries = points needed for max bond.

### Change bond event values (how much each event awards)
**Search for:** `const BOND_EVENT_VALUES: {[event: string]: number} = {`

If you change these, also update the bond rules text in the prompt — search for `Valid events and their amounts:` and update accordingly.

### Change seed scaling (base + per level)
**Search for:** `const computeMaxSeeds = (level: number): number =>`

Currently `5 + Math.max(1, level)`. Change the formula however you like.

### Change long rest behavior
**Search for:** `longRest(): void {`

By default it restores HP, MP, and seeds to maximum. Trim or expand as desired.

---

## Tuning the AI Prompt

### Change rules the AI follows
**Search for:** `formatStatsForPrompt(): string {`

This whole method builds the prompt sent to the AI. The big template string contains every rule section:
- `Roll request rules:` — when and how the AI should request d20 rolls
- `Player rules:` — state update syntax for player stats
- `Companion rules:` — mood changes, adding/removing companions
- `Bond rules:` — event types, when to award bond
- `Seed rules:` — when companions can/can't cast
- `Long rest rules:` — when to declare a long rest
- `Spell casting rules:` — what companions can cast
- `Location rules:` — when to change location
- `Roll interpretation:` — how to narrate roll results
- `General rules:` — fallback rules

Edit the rule text directly in the template literal. Keep the rules brief — every line costs context.

### Change difficulty class suggestions for rolls
**Search for:** `dc is optional but recommended.`

Currently: easy 10, medium 15, hard 20, very hard 25.

### Change how rolls are interpreted by total
**Search for:** `If no DC: total 1-5 poor`

The bands map total → narrative outcome.

---

## UI Tweaks

### Reorganize the panel layout
**Search for:** `renderInner(): ReactElement {`

This method renders the entire panel. Major sections in order:
1. Location image and name
2. Player stats row (HP/MP/Level/XP/Seeds)
3. Long rest button
4. Ability score grid (STR/DEX/CON/INT/WIS/CHA)
5. Inventory
6. Tome
7. Spell choice picker (only when triggered)
8. Roll panel (idle/pending/resolved)
9. Active companions
10. Dev test button (only in DEV_MODE)

To move a section, cut its `<div>` block and paste it where you want.

### Change colors, fonts, sizes
Each visual block has inline `style={{}}` props. Search for the section you want to tweak (e.g., `Long rest`, `Tome`, `Active Companions`) and find the style object.

Theme colors I've used:
- Background: `rgba(20, 20, 30, 0.85)`
- HP red: `#ff6b6b`
- MP blue: `#6bb6ff`
- Level/Crit gold: `#ffd56b`
- Seeds/Success green: `#aac46b`
- Bond bar blue: `#7aaeff`

### Resize companion portraits
**Search for:** `width: '120px',`
The first occurrence styles the portrait image. The second (a few lines down) styles the placeholder shown when there's no image.

---

## Adding New State Fields

When adding any new field that gets persisted across messages, you must update **all three** of these places, or risk schema-mismatch crashes:

1. **The type:** search for the relevant type definition (`PlayerStats`, `Companion`, `MessageStateType`, etc.) and add the field.
2. **The default:** search for `const defaultPlayer` or the relevant default and provide a starting value.
3. **The constructor merge:** search for `const mergedPlayer` (or `const mergedCompanions`) and backfill the field defensively for old saves.
4. **The setState merge:** search for `async setState(state: MessageStateType)` and add the same backfill there.
5. **Both lifecycle returns:** search for `messageState: {` (appears twice — once in `beforePrompt`, once in `afterResponse`) and include the new field.

Skipping step 4 causes "works in test runner but breaks in real chats" bugs. Skipping step 5 causes state not to persist between turns.

---

## Common Gotchas

- **Rule of thumb for adding any new tag the AI emits:** add it to `parseStateUpdate`, add the rules to the prompt template, and add a test scenario to the dev button.
- **The `[STATE: ]` block uses `=`, `+=`, `-=`** — companion mood is a special `companion.<id>.mood=` form. Bond uses a separate `[BOND: ]` tag entirely.
- **Long rest is a single tag `[LONG_REST]`** — no parameters. Don't try to add fields.
- **Roll requests are a single tag `[ROLL_REQUEST: ...]`** with comma-separated fields.
- **Filename case matters in production** but not in Codespaces. Always check production paths in GitHub web UI.
- **DEV_MODE = true means `window.location.reload()` runs after dev test clicks.** This breaks Chub iframe. Always set to false before pushing.

---

## When Something Breaks

1. **Test runner works, production doesn't:** schema-mismatch from old saved state. Search for `setState` and `mergedPlayer` — make sure new fields have backfill logic.
2. **Stage doesn't render at all:** open Chub DevTools (F12) → Console. Find the red error. The error message usually names the field that's missing.
3. **AI ignores a rule:** prompt rules can drift in priority as the prompt grows. Try moving the rule earlier in the template, or making it more emphatic.
4. **A tag isn't being applied:** check `parseStateUpdate` — does the regex match what the AI is actually emitting? Console logs the input, so you can compare.
5. **TypeScript errors after an edit:** if there's a flood, the most likely cause is one missing/extra brace breaking everything below it. Check the line before the first error carefully.

---

## File Map

```
src/Stage.tsx                — main file, almost everything lives here
src/TestRunner.tsx           — dev-only, don't touch
src/assets/test-init.json    — test data; mostly safe to ignore
public/chub_meta.yaml        — stage identity (project_name, etc.)
public/characters/Niri_*.gif — companion mood images, case-sensitive
public/Locations/loc_*.png   — location backgrounds, case-sensitive
.github/workflows/deploy.yml — auto-deploy to Chub on push
```
