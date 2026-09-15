# Reviews curated data and asset maintenance

Some Reviews features enrich Warcraft Logs data with information that WCL does not
provide directly. This document describes how to maintain those curated additions
without introducing runtime network dependencies or fragile name matching.

It is also the master checklist for bringing a new raid tier into Reviews. The
application and WCL server are separate repositories and both may need changes:

- **Updater:** this repository.
- **WCL server:** `../Rak Gaming Announcer/RakGamingUpdater-Server`.

## Quick release checklist

- [ ] Collect representative reports and build an encounter support worksheet.
- [ ] Verify WCL encounter IDs, difficulties, progress, phases, and map IDs.
- [ ] Smoke-test report/fight selection and generic timelines before adding exceptions.
- [ ] Add and document one bundled Encounter Journal portrait per encounter.
- [ ] Audit the global player cooldown catalog for patch/class/item changes.
- [ ] Audit boss casts, interrupts, duplicates, targets, and defaults on every difficulty.
- [ ] Add only evidence-backed boss enrichments and encounter alerts.
- [ ] Build and visually align local replay-map tiles for every raid floor.
- [ ] Validate generic replay data, actor lifecycle, facing, casts, and performance.
- [ ] Add encounter-specific replay extensions only where generic replay is insufficient.
- [ ] Increment every affected cache/protocol version and coordinate server/client changes.
- [ ] Add/update tests, translations, source provenance, and maintainer comments.
- [ ] Run the automated and manual acceptance matrix in attached and detached modes.
- [ ] Remove temporary queries/exports and review both worktrees before committing.
- [ ] Deploy, then smoke-test one old/cached report and one newly uploaded report.

## Design rules

- Treat WCL numeric identifiers as identity. Display names are presentation data and
  can be localized or renamed.
- Keep curated data in a small, explicit manifest close to the feature that consumes
  it.
- Bundle visual assets with the application. Do not hotlink an external CDN from the
  renderer.
- Missing curated data must degrade cleanly. A new encounter should remain usable
  before its artwork or special handling is added.
- Record where every manually sourced asset came from so it can be audited or
  replaced later.
- Keep acquisition and conversion tooling out of the runtime application. These are
  maintenance operations, not user-facing behavior.

## What should work automatically

Do not create encounter-specific configuration merely because a new raid exists.
Start from the generic behavior, inspect real logs, and add exceptions only when the
generic result is incomplete or misleading.

| Area | Generic behavior for a new raid | Expected maintenance |
| --- | --- | --- |
| Reports and fights | WCL supplies fights, difficulty, duration, kill state, progress, phase definitions, and phase transitions. | Validate metadata and unknown difficulty IDs. |
| Pull numbering and progress colors | Derived from WCL fight metadata. | No per-encounter entries. Visually verify cyclic phases and partial pulls. |
| Player cooldown timeline | Uses the global class/item cooldown catalog. | Review it when a patch changes player spells or consumables, not for every boss. |
| Boss timeline | Discovers enemy casts and interrupts automatically. | Inspect noise, duplicate selectors, missing targets, and difficulty-specific IDs. |
| Pull comparison | Reuses the timeline and longest-pull boss data. | Validate ordering, phase lines, deaths, filters, and seeking. |
| Replay actors and casts | Generic WCL replay processing. | Validate actor lifecycle, coordinates, facing, and event volume. |
| Replay map | Has a lower-quality network fallback when assignment metadata is unambiguous. | Bundle and verify raid floors for release-quality support. |
| Encounter art | Text-only header fallback. | Add one local Journal portrait for every encounter. |
| Encounter alerts and special replay mechanics | None. | Add only when a mechanic has a useful, evidence-backed representation. |

## New raid master checklist

### 1. Collect representative logs

Create a small support worksheet before changing code. For every encounter, record:

- encounter name and WCL `encounterID`;
- known difficulty IDs;
- at least one kill or longest available pull per relevant difficulty;
- one short wipe and one pull that reaches every phase;
- fight `maps { id }` values and map IDs observed on position events;
- phase IDs, names, order, intermission flags, and whether phases repeat;
- Encounter Journal artwork URL;
- boss casts reviewed, target mechanics reviewed, replay reviewed, and final status.

Prefer public reports in committed tests and documentation. Never commit WCL access
tokens, development-bridge descriptors, private report exports, player-identifying
raw combat logs, or OBS/YouTube credentials.

The development query bridge can inspect private reports without adding one-off code.
Start the development app with a working WCL session, put a query and variables in
temporary files, then run:

```powershell
npm.cmd run wcl:query -- .\tmp\new-raid.graphql `
  --variables .\tmp\new-raid.variables.json `
  --out .\tmp\new-raid.result.json
```

Use this initial inventory query:

```graphql
query ReviewNewRaidInventory($reportCode: String!) {
  reportData {
    report(code: $reportCode) {
      code
      title
      startTime
      endTime
      zone {
        id
        name
        encounters {
          id
          name
        }
      }
      phases {
        encounterID
        phases {
          id
          name
          isIntermission
        }
      }
      fights {
        id
        name
        encounterID
        difficulty
        startTime
        endTime
        bossPercentage
        fightPercentage
        kill
        phaseTransitions {
          id
          startTime
        }
        maps {
          id
        }
      }
    }
  }
}
```

The encounter ID, fight ID, NPC game ID, zone ID, terrain map ID, UI map ID, spell
ID, and Encounter Journal ID are different namespaces. Keep column names explicit in
notes and code.

### 2. Validate report and fight selection

The server query lives in
`RakGamingUpdater-Server/src/api/wcl/queries.ts`, and normalization is in
`RakGamingUpdater-Server/src/api/wcl/reports.ts`. A normal raid should require no
new fields.

For each difficulty and encounter, verify:

- reports group under the correct day and fights group by encounter/difficulty;
- newest pulls appear first while pull numbers remain chronological;
- difficulty abbreviations are correct; an unknown ID must remain `[id]` until its
  meaning is confirmed and added to `ReviewWclSelectors.vue`;
- `fightPercentage` drives remaining-health color and `bossPercentage` is only the
  compatibility fallback;
- kills are visually distinct from wipes;
- phase and intermission labels follow WCL definitions, including repeated phases;
- switching reports clears stale fights, streams, timeline state, and replay state;
- custom WCL report URLs can select a report and optional fight; and
- private reports work through the normal authenticated flow.

If WCL metadata is wrong or missing, first confirm it on more than one report and
difficulty. Prefer a safe generic fallback over a raid-wide hardcode.

### 3. Add encounter artwork

Follow the detailed [encounter-art workflow](#encounter-artwork-in-the-fight-selector)
for every encounter. Artwork is the only expected per-encounter UI entry for an
otherwise generic raid.

### 4. Review the player cooldown catalog for the patch

The catalog is server-owned in
`RakGamingUpdater-Server/src/data/reviewCooldownCatalog.ts`; the renderer consumes
the returned group and spell metadata. Review the catalog when the raid ships with a
major class, talent, spell, or consumable update.

- Compare the current retail spell set with Lorrgs. Keep queryable abilities that
  Lorrgs hides, but put them in `REVIEW_COOLDOWN_DEFAULT_DISABLED_SPELL_IDS`.
- Verify every spell ID and English spell-name comment against the current Wago Tools
  `SpellName` table.
- Confirm the category, primary category, and default-enabled state. One spell may
  belong to multiple categories.
- Determine whether WCL emits `cast`, `applybuff`, `applydebuff`, `removebuff`, or a
  combination. Aura tracking remains ID-based.
- Keep item matching name-based in `REVIEW_COOLDOWN_ITEM_DEFINITIONS` when consumable
  IDs vary, and map the name to one canonical timeline spell ID.
- Check alternate interrupt IDs, pet command/owner attribution, and whether successful
  interrupts use a different event spell ID.
- Add narrowly scoped normalization only for demonstrated behavior such as duplicate
  talented casts or spec-dependent categories.
- Increment `REVIEW_COOLDOWN_CATALOG_VERSION` for every catalog or normalization
  change that can alter fetched results. It is part of the server cache key.

Test at least one player of every class and both tank/healer/DPS roles. Confirm spec
icons, role/class/name sorting, targets, raid markers, pets attributed to owners,
deaths/resurrections, and source/target duplication for external cooldowns.

### 5. Audit boss casts on real pulls

The base fetch and pagination are in `RakGamingUpdater-Server/src/api/wcl/fights.ts`;
normalization is in `src/utility/reviewBossCastEvents.ts`. First inspect the generic
result on the longest pull of every encounter.

Check all supported difficulties because spell IDs and event shapes may differ:

- player and mind-controlled-player casts are excluded;
- Environment casts are hidden by default;
- melee swings and passive/proc events do not pollute the list;
- begin, complete, and interrupt outcomes are represented by evidence from their own
  events rather than inferred completion;
- source NPC, spawn instance, raid marker, target list, and target markers are correct;
- cast bars use trustworthy start/outcome timing;
- repeated casts aggregate using the timeline's shared rules; and
- pull comparison uses boss spells from the longest selected pull.

Only then add entries to
`RakGamingUpdater-Server/src/data/reviewBossCastEnrichments.ts`:

- `REVIEW_BOSS_CAST_TARGET_DEBUFF_DEFINITIONS` associates a cast with target auras.
  Capture IDs from every difficulty and derive association windows from observed
  timestamps. Do not synthesize unmatched applications unless the timeline event is
  useful and the relationship is proven.
- `REVIEW_BOSS_CAST_ABILITY_OVERRIDES` supplies a more useful timeline label or a
  different default-visible state while retaining the real spell ID.
- `REVIEW_BOSS_CAST_SUPPRESSED_ABILITIES` removes proven duplicate selector/proc
  events, not merely unfamiliar spells.
- `REVIEW_BOSS_CAST_START_FALLBACK_DEFINITIONS` retains an unmatched `begincast`
  only for mechanics where WCL demonstrably omits the terminal event. Keep this
  allowlist narrow: the UI labels such evidence as "started" and must not infer a
  successful completion.

Encounter-specific shortcuts attached to boss-cast occurrences live in the updater's
`app/reviewBossCastActions.ts`. Add them to that data-driven registry rather than to
timeline templates. URL builders must use `URLSearchParams` for WCL pins and preserve
the normal left-click seek action. When WCL exposes a stable phase for the mechanic,
prefer its `phase` parameter and omit redundant time bounds. Otherwise use
report-relative fight/occurrence timestamps and clamp the viewport to the pull. Verify
the shortcut in collapsed, full, comparison, and detached views. Prefer
mechanic-specific cast-start/end windows over a broad centered window when the
encounter provides a reliable duration. Scope damage pins to the intended NPC or to an
aura-presence range so overlapping mechanics cannot leak into the result.

Increment `REVIEW_BOSS_CAST_ENRICHMENTS_VERSION` whenever an enrichment can change
the returned data. Add fixtures to `src/utility/reviewBossCastEvents.test.ts`, covering
successful casts, interrupts, duplicate NPCs without reliable instances, target
association boundaries, and difficulty variants.

### 6. Add encounter alerts sparingly

Encounter alerts are exceptional, high-value events such as a mechanic reaching the
boss and healing it. They are not a second boss-spell catalog.

Definitions live in
`RakGamingUpdater-Server/src/data/reviewEncounterAlerts.ts`. Before adding one:

- identify the exact WCL event type, spell ID, hostility side, source, and target;
- verify it on a success and a failure, across applicable difficulties;
- make the label short and the description explain what went wrong;
- verify that the event timestamp is the moment a reviewer needs to see;
- reuse normal aggregation and seeking behavior; and
- ensure its narrow filter does not materially increase pages or quota use.

Increment `REVIEW_ENCOUNTER_ALERTS_VERSION`, update
`src/data/reviewEncounterAlerts.test.ts`, and verify the alert in collapsed, expanded,
comparison, and detached timeline contexts.

If an addition introduces client-owned wording, add the key to every locale under
`app/translations`. Encounter and ability names supplied by WCL should remain data,
not duplicated translation keys. Server-provided alert labels/descriptions are
currently English data; changing that contract requires an explicit localization
design rather than embedding locale branches in the registry.

### 7. Add and verify replay maps

Generic replays work without a bundled background, but every release-supported raid
floor should have local map tiles. Full technical details are in `app/replayMaps.ts`
and `scripts/build_replay_maps.py`.

For a new raid:

1. Gather UI map IDs from fight `maps { id }` and actual position samples. Do not feed
   terrain map IDs into the builder.
2. Update the builder's pinned `SOURCE_BUILD` to a verified current Retail build.
3. Add the raid floors to `DEFAULT_UI_MAP_IDS`.
4. Install/update Pillow if needed and build one floor first:

   ```powershell
   python .\scripts\build_replay_maps.py <uiMapID>
   ```

5. Inspect base and maximum-resolution tiles, then build all configured floors.
6. Commit the generated WebP pyramid and updated manifest together.

Validate pull start and late-fight positions, at least two distant points, facing
orientation, Follow and Whole pull modes, pan/zoom, tile boundaries, multi-floor
selection, detached mode, and GPU memory. A convincing but misaligned background is
worse than the grid fallback; never guess coordinate bounds.

### 8. Add encounter-specific replay behavior only with evidence

The generic replay contract and server maintainer notes live in
`RakGamingUpdater-Server/src/utility/reviewReplayEvents.ts`. Encounter extensions are
registered server-side in `src/data/reviewReplayExtensions.ts` and renderer-side in
`app/renderer/replay/replayExtensions.ts`.

When a mechanic genuinely benefits from replay visualization:

- prove which WCL events define spawn, assignment, movement, success, failure, death,
  despawn, and refixation behavior;
- save small anonymized fixtures containing boundary and failure cases;
- request the narrowest event streams possible;
- mark nonessential precision/enrichment streams `required: false` so base replay can
  still load;
- keep processing deterministic and separate from Vue rendering;
- use typed overlays and a dedicated renderer component;
- ensure unknown overlays are safe for older/detached clients to ignore;
- test actor instances and lifecycle changes instead of assuming one NPC per report
  ID; and
- measure WCL page count, payload size, server processing time, client transfer time,
  and render responsiveness on the longest pull.

Do not fetch all damage/healing events as a default precision strategy. Optional
streams currently have a small independent page budget, and base replay has its own
budget. Broaden either only after measuring representative pulls and confirming quota
impact.

If the serialized replay contract changes, update matching server/client types and
increment `REVIEW_REPLAY_VERSION` in both
`RakGamingUpdater-Server/src/utility/reviewReplayEvents.ts` and `app/replay.ts` in the
same release. A map-only asset update does not require a protocol bump.

### 9. Review caching, compatibility, and deployment

Fight event, cooldown, boss-cast, actor, and replay data are cached because completed
pulls are immutable. Before deployment:

- increment the relevant data version constant when changing server-derived results;
- verify that cache keys include the version and encounter identity where required;
- never cache a failed or incomplete supplemental request as a valid empty result;
- ensure partial boss-cast/replay enrichment can retry without discarding good base
  data;
- coordinate server and app deployment when a transport/type contract changes; and
- restart the development server after server code changes before treating a stale
  result as an application bug.

New local artwork and map assets are Vite content-hashed and need no data-version
bump. During a rolling deployment, replay protocol mismatches are deliberately
rejected; deploy coordinated server/client versions and verify the unavailable-state
UX rather than silently accepting incompatible data.

### 10. Run the release acceptance matrix

Automated updater checks:

```powershell
npx.cmd vue-tsc --noEmit
node scripts/reviewFights.test.mjs
node scripts/reviewBossCastActions.test.mjs
node scripts/reviewPhaseTransitions.test.mjs
node scripts/reviewReports.test.mjs
node scripts/replay.test.mjs
node scripts/reviewSynchronization.test.mjs
node scripts/reviewVideoSelection.test.mjs
node scripts/timelineWindow.test.mjs
node scripts/wclReportUrl.test.mjs
npx.cmd vite build
git diff --check
```

Automated WCL server checks, run from `../Rak Gaming Announcer`:

```powershell
npm.cmd run typecheck:server
npx.cmd vitest run RakGamingUpdater-Server/src/api/WCL_API.test.ts
npx.cmd vitest run RakGamingUpdater-Server/src/api/wcl/eventLoader.test.ts
npx.cmd vitest run RakGamingUpdater-Server/src/api/wcl/replay.test.ts
npx.cmd vitest run RakGamingUpdater-Server/src/data/reviewCooldownCatalog.test.ts
npx.cmd vitest run RakGamingUpdater-Server/src/data/reviewEncounterAlerts.test.ts
npx.cmd vitest run RakGamingUpdater-Server/src/utility/reviewBossCastEvents.test.ts
npx.cmd vitest run RakGamingUpdater-Server/src/utility/reviewCooldownEventFilters.test.ts
npx.cmd vitest run RakGamingUpdater-Server/src/utility/reviewReplayEvents.test.ts
```

Also run every new encounter-extension test. Tests are necessary but do not replace
visual checks with real reports.

Manually verify at minimum:

- one kill, one early wipe, and one longest pull for every encounter;
- every supported difficulty represented in available logs;
- report/fight selection, progress colors, phase labels, and custom URLs;
- collapsed and expanded Raid views;
- every cooldown filter and spell filter persistence while switching bosses;
- deaths, pending resurrections, accepted resurrections, targets, marks, and pets;
- boss casts in collapsed/full modes, target details, interrupts, aggregation, and
  Wowhead links/tooltips;
- pull comparison sorting, infinite loading, phase alignment, longest-pull boss casts,
  and cross-pull seek;
- replay actors, facing, casts, background, zoom, controls, paused seeking, and any
  encounter extension;
- attached, detached, minimized, reattached, and application-quit behavior;
- YouTube selection, stream/report matching, manual offset, automatic sync marker,
  queued seeks, frame stepping, hotkeys, fullscreen, and open-at-time links; and
- light/dark theme, narrow window, scrollbars, dropdown stacking, loading/error/empty
  states, and retry behavior.

Watch development and production-like server logs for WCL GraphQL errors, page-budget
exhaustion, incomplete supplemental streams, actor attribution warnings, unexpected
empty results, slow requests, and repeated refetching. Record known gaps explicitly;
do not hide uncertain data behind a polished but unsupported visualization.

### 11. Commit and deploy cleanly

Keep reviewable concerns separate when possible:

1. generic/schema changes and tests;
2. cooldown catalog updates;
3. boss-cast enrichments and alerts;
4. replay maps/assets;
5. encounter-specific replay extensions; and
6. UI artwork/polish.

When the work began as one large experimental change, first review both repositories,
separate generated assets from logic, remove diagnostics and temporary exports, run
the full matrix, and only then split commits along those boundaries. After deploying,
smoke-test a previously cached report and a newly uploaded report.

## Encounter artwork in the fight selector

The fight selector groups pulls by encounter and difficulty. Its group header can
show a World of Warcraft Encounter Journal portrait. The implementation has three
parts:

- `app/assets/review-encounters/<encounterID>.webp` contains the bundled image.
- `app/reviewEncounterArt.ts` maps the WCL encounter ID to the imported asset.
- `app/renderer/components/ReviewWclSelectors.vue` attaches the resolved image to
  the dropdown section. `Dropdown.vue` owns only the generic section-image layout.

An encounter absent from the manifest intentionally receives the normal text-only
section header. Do not add a guessed mapping or match artwork by encounter name.

### 1. Find the encounter ID

Use the `encounterID` returned with WCL fight data. For development, the repository's
WCL query bridge can query a known report:

```graphql
query ReviewEncounterIDs($reportCode: String!) {
  reportData {
    report(code: $reportCode) {
      zone {
        encounters {
          id
          name
        }
      }
      fights {
        id
        encounterID
        name
      }
    }
  }
}
```

Confirm the ID against at least one real fight. Do not use the fight ID, NPC ID,
zone ID, map ID, or Encounter Journal ID in its place; they identify different
things.

### 2. Find the Encounter Journal artwork

Open the corresponding Wowhead encounter guide and find the encounter overview's
`Image` link. It normally resolves to a URL shaped like:

```text
https://wow.zamimg.com/images/wow/journal/ui-ej-boss-<name>.png
```

Download the original image once. Do not put that remote URL into application code.
Prefer the Encounter Journal image over a guide banner or screenshot because the
Journal assets have a consistent transparent 2:1 composition.

If no appropriate Journal image exists, leave the encounter unmapped until a stable
asset is available. For multi-boss encounters, prefer the official combined Journal
image rather than arbitrarily selecting one boss.

### 3. Prepare the asset

The current source images are 128 x 64 pixels. Preserve that 2:1 aspect ratio and
transparent background. Store the result as lossless WebP named with the decimal WCL
encounter ID:

```powershell
ffmpeg -i .\source.png -c:v libwebp -lossless 1 -compression_level 6 `
  .\app\assets\review-encounters\3429.webp
```

Do not upscale these assets: the selector renders them at 64 x 32 pixels. If a future
source is larger, resizing to 128 x 64 is sufficient. Check the converted file before
committing it and make sure transparency was preserved.

### 4. Register and document it

Import the WebP in `app/reviewEncounterArt.ts`, then add one entry to
`REVIEW_ENCOUNTER_ART` using the WCL encounter ID as the key. Keep the entries sorted
numerically.

Add the encounter, ID, and original source URL to the source table below. The source
URL is provenance only and is never requested by the application.

### 5. Validate the result

Run the relevant automated checks:

```powershell
npx.cmd vue-tsc --noEmit
node scripts/reviewFights.test.mjs
npx.cmd vite build
git diff --check
```

Then inspect the fight dropdown with real data and verify:

- the image belongs to the encounter represented by that section;
- the image appears once in the section header, not on every pull card;
- the header remains readable in both light and dark themes;
- scrolling between encounter groups does not overlap or clip the sticky header;
- pull cards retain their two-column layout and progress information;
- an encounter without a manifest entry still has a clean text-only header; and
- the production build contains a hashed copy of the new WebP asset.

## Current encounter-art sources

| Encounter ID | Encounter | Original source |
| ---: | --- | --- |
| 3379 | Nymrissa Wavecaller | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-nagasorcerer.png` |
| 3420 | Sszorak | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-brute.png` |
| 3421 | The Twin Fangs | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-twins.png` |
| 3429 | The Coiled Altar | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-zuljanmalacrass.png` |
| 3445 | Entombed Sentinels | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-golems.png` |
| 3455 | Vashnik the Malignant | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-alchemist.png` |
| 3470 | Nek'zali the Soulcoiler | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-priestess.png` |
| 3492 | Ula'tek | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-ulatek.png` |
| 3497 | The Lost Explorers | `https://wow.zamimg.com/images/wow/journal/ui-ej-boss-tortollans.png` |

## Adding other curated Reviews data

Use the same pattern for future manual additions such as encounter aliases, special
timeline alerts, or replay presentation metadata:

1. Identify the stable WCL key and document what it represents.
2. Put domain-specific data in a dedicated module instead of expanding a generic UI
   component.
3. Expose a small lookup or transformation function to consumers.
4. Define the behavior for missing data before adding the first entry.
5. Record external sources and any conversion steps here or in a linked specialist
   document.
6. Add a focused automated test for logic; use a visual checklist for presentation.

If the curated list becomes large enough to be error-prone, add a build-time
validation script that checks duplicate IDs, missing assets, source-table coverage,
and image dimensions. Do not move these checks into renderer startup.
