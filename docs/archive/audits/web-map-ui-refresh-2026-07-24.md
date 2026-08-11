# CoreMap Public Web Map UI Refresh Report

**Date:** 2026-07-24  
**Scope:** `apps/web` public map interface  
**Goal:** Make the interface brighter, more modern, and more professional without changing working features, user flows, map behavior, responsive behavior, or established visual effects.

## Executive summary

The current public map has a sound interaction model:

- desktop floating navigation rail
- desktop sidebar that can collapse without covering the map
- mobile top navigation and three-state bottom sheet
- floating map, language, transport, zoom, and location controls
- search, place detail, routing, saved-place, report, account, and transport surfaces
- glass backgrounds, rounded corners, shadows, selected-marker halos, and animated transitions

The refresh should preserve that model. The main issue is not UX architecture; it is visual-system consistency. Most surfaces are white or neutral gray, bright color is limited to a few active controls, primary actions alternate between blue and black, and some search classes reference design tokens that are not defined. The result is functional but flatter and less cohesive than the product deserves.

The implemented direction is **Bright Precision**: clean blue as the primary brand color, cyan as a restrained secondary highlight, soft blue-gray application surfaces, white content cards, and the existing green/orange route endpoint language.

## Inspection coverage

The interface was inspected at:

- desktop: 1280 × 720
- mobile: 390 × 844
- mobile half-height bottom sheet
- mobile expanded bottom sheet
- default search state
- directions state
- saved-places and unauthenticated account states
- sign-in form state
- navigation, floating controls, location control, and empty/loading surfaces
- MapLibre overview style and marker color configuration

The local inspection environment could not fetch the configured PMTiles archive. The blank basemap observed during inspection was therefore not classified as an application defect. The basemap palette was reviewed from its MapLibre style configuration instead.

## Findings

### 1. Preserve the existing UX architecture

The rail/sidebar model works well on desktop and the top-navigation/bottom-sheet model is appropriate on mobile. The current sheet heights, sidebar collapse behavior, mode switching, map controls, route form behavior, and information hierarchy should remain.

No feature, route, event handler, store action, map action, API call, or responsive mode should be removed as part of the visual refresh.

### 2. Complete the design-token layer

`SearchPanel` uses classes including:

- `rounded-map-control`
- `rounded-map-card`
- `bg-map-surface`
- `bg-map-bg`
- `text-map-ink`
- `text-map-muted`
- `border-map-border`
- `shadow-map-control`

These tokens were not defined in the Tailwind v4 theme. In the rendered UI, this caused the search field to lose the intended radius, border color, text colors, and shadow.

**Recommendation:** Define the tokens centrally and use them for shared map surfaces. This is the highest-priority correction because it fixes both a visual defect and future consistency.

### 3. Establish one brand palette

Current active navigation generally uses `sky-600`, selected chips use neutral black, and the primary routing CTA uses near-black. This makes related primary actions look unrelated.

**Recommended palette:**

| Role | Value |
|---|---|
| Primary | `#1677ff` |
| Primary hover | `#0f68e8` |
| Secondary/cyan | `#20c7e8` |
| Primary soft | `#eaf4ff` |
| App background | `#f4f8fc` |
| Surface | `#ffffff` |
| Main ink | `#10243e` |
| Muted ink | `#667085` |
| Border | `#d8e4f0` |
| Error | `#dc2626` |
| Route origin | existing emerald |
| Route destination | existing orange |

Bright color should be concentrated in active controls, primary actions, focus states, selected results, route states, category badges, and map markers. Content surfaces should remain calm and readable.

### 4. Preserve and standardize elevation

The existing shadows and glass effects are valuable and should remain. They currently use several unrelated neutral shadows.

**Recommendation:** Keep the same visual depth while expressing it through shared control, card, and floating-surface shadow tokens. Use a slight blue tint for active-control elevation, while keeping the sidebar and sheet shadows neutral.

### 5. Improve mobile target size and control positioning

During inspection, the scaled mobile navigation produced approximately 40 × 40 pixel buttons, and the zoom buttons were smaller. The expanded bottom sheet also crowded the location control between the top navigation and right-side controls.

**Recommendation:**

- remove the mobile rail scale
- use at least 44 × 44 pixel mobile navigation and map-control targets
- keep the current control functions and placement model
- move the location control to a dedicated free area when the sheet is expanded
- preserve the existing 300 ms bottom-sheet movement

### 6. Unify focus states

Some controls provide a custom focus ring while others rely on the browser default. This creates inconsistent colored outlines and reduces visual polish.

**Recommendation:** Provide a common accessible `focus-visible` outline/ring using the primary color. Do not remove keyboard focus indication.

### 7. Refine search and empty states

Search should remain the primary desktop sidebar entry point and the first mobile sheet state. It should look like a modern control rather than a form field embedded in a plain page.

**Recommendation:**

- 50–52 pixel height
- 16 pixel radius
- soft border and control shadow
- stronger blue focus state
- selected category chips in primary blue instead of black
- softly colored category badges
- compact empty state with an icon and useful next-step copy

### 8. Refine routing without changing behavior

The routing feature already has a clear hierarchy and strong endpoint color semantics.

**Recommendation:**

- keep emerald origin and orange destination
- keep all route modes and disabled transit modes
- use primary blue for selected mode and `Get route`
- use shared card/surface tokens
- retain route-state banners, feedback flow, loading state, and route-step behavior

### 9. Brighten the basemap carefully

The existing overview colors are subdued and professional. They can be made cleaner and brighter without competing with map markers or labels.

**Recommended direction:**

- clearer sky-blue ocean and lake fills
- slightly fresher off-white/green land
- soft green regional variation
- restrained roads and labels
- unchanged marker hierarchy
- preserve orange selected POIs and teal/indigo transport distinctions

## Non-regression requirements

The refresh must retain:

- every existing sidebar mode and mode transition
- all map-store actions and callbacks
- all search/filter/request behavior
- place selection and detail behavior
- route endpoint, mode, swap, map-pick, request, result, error, and feedback behavior
- saved places, reports, account, share, transport, and location behavior
- desktop collapse behavior
- mobile collapsed/half/expanded sheet behavior
- current blur, shadow, halo, hover, and transition effects
- MapLibre rendering architecture and PMTiles delivery
- Myanmar and English label support

## Implementation sequence

1. Add shared Tailwind v4 map tokens and global accessibility defaults.
2. Update shared sidebar cards, buttons, chips, metadata, and rows.
3. Refresh the navigation rail and account-control visual language.
4. Refresh the sidebar and mobile sheet while preserving dimensions and transitions.
5. Refresh floating controls and mobile target sizes.
6. Refresh search, empty states, and directions.
7. Apply a restrained basemap palette adjustment.
8. Run build, lint/tests where practical, and visually verify desktop/mobile states.

## Acceptance criteria

- Search tokens render correctly.
- Search and card radii are consistent.
- Primary actions use one recognizable brand color.
- Selected chips are no longer unrelated black elements.
- Mobile primary controls meet a 44 pixel target where space permits.
- Keyboard focus is consistently visible.
- Existing behaviors and effects remain intact.
- TypeScript build succeeds.
- Existing map tests succeed.
- Desktop and mobile screenshots show no overlap or clipping introduced by the refresh.

## Implementation result

Implemented in this change:

- added the missing Tailwind v4 map design tokens
- added consistent keyboard focus and reduced-motion behavior
- refreshed the public-map canvas, cards, labels, metadata, buttons, chips, and result rows
- retained and standardized existing glass, blur, shadow, hover, and transition effects
- refreshed the desktop/mobile navigation rail without changing its modes or handlers
- refreshed the sidebar and mobile Min/Half/Full states without changing their behavior
- increased mobile navigation, map-control, zoom, and location targets
- moved the expanded-sheet location control into unused map space to avoid the former control cluster
- refreshed search styling and its loading, error, and empty states
- refreshed the directions form, mode picker, CTA, route summary, metrics, and map-pick actions
- retained origin/destination colors and every routing behavior
- refreshed the remaining secondary surfaces: authentication, profile, email
  verification, saved places, reports, report modal, sharing, place/address detail,
  transport detail, route feedback, endpoint search, region selection, and location
  feedback
- replaced the remaining legacy neutral/black/sky component styling in those
  surfaces with the shared map tokens
- applied the restrained brighter overview and regional basemap palette

Validation completed:

- `npm run build` in `apps/web`: passed
- `npm run test:map` in `apps/web`: 135 tests passed
- `npm test` in `packages/map-style`: 14 tests passed
- desktop visual inspection at 1280 × 720: passed
- mobile visual inspection at 390 × 844, including half and expanded sheets: passed
- refreshed search, saved-place, and sign-in states were inspected on the running app
- scan for the superseded component color/elevation patterns in the refreshed
  secondary surfaces: clean

The targeted ESLint run still reports pre-existing hook/configuration findings in
`LocationToast`, `AddressLocationPanel`, `ReportModal`, and `RegionCombobox`.
They concern synchronous state updates inside existing effects, an existing effect
dependency warning, and an unavailable `jsx-a11y/no-autofocus` rule—not the visual
token migration. The repository-wide web lint command also contains other
pre-existing findings outside this refresh.

## Follow-up content refinement — 2026-07-28

### Findings

The refreshed visual system was complete, but the location and directions panels
still had content-density issues:

- panel titles were repeated inside cards
- four equal-width location actions forced Burmese labels to wrap
- Save and Report had different guest/authenticated layouts
- route inputs repeated long placeholder and helper text
- enabled and disabled route modes competed for one narrow row
- the language menu repeated the already-selected language
- reverse-address requests did not follow the selected UI language

### Recommendations applied

- keep one clear panel heading and remove repeated card headings
- use short action copy: From/To, Share, Copy, Save, and Report
- group location actions into balanced two-column rows
- keep all guest and authenticated actions visible in the same layout
- shorten route labels and map-pick actions while retaining tooltips and accessible names
- place enabled route modes in one row and unavailable transit modes in a quieter secondary row
- hide the current language from the open language menu because it is already shown on the control
- request localized reverse-address content whenever the language changes
- clamp long address display to two lines without changing the underlying saved/shared value

### Follow-up validation

- `npm run build --prefix apps/web`: passed
- `npm run test:map --prefix apps/web`: 135 tests passed
- targeted ESLint for all follow-up files: passed
- desktop visual inspection at 1280 × 720: passed
- mobile visual inspection at 390 × 844: passed
- Burmese default UI: passed
- live Burmese/English content switching: passed
- location action and route-mode wrapping check: passed
- existing shadows, blur, hover movement, active blue elevation, map actions, routing
  callbacks, authentication entry, reporting, sharing, saving, and responsive sheet
  behavior remain intact

Repository-wide lint still reports existing findings outside this follow-up:
unused variables in map interaction/validation files, an unavailable
`jsx-a11y/no-autofocus` rule, and existing React hook/ref findings in the report
modal and home page.

### Place-detail refinement

The place-detail card was subsequently aligned with the compact location card:

- removed the repeated inner “Place” label
- grouped the back action, place title, category, area, and verification state
  into one compact header
- changed the crowded four-column Burmese action row into two balanced columns
- shortened actions to From, To, Share, Copy, Save, and Report
- moved category and area out of the metadata table
- moved verification state into a small title badge
- limited metadata to the localized address, coordinates, and Plus Code
- added Myanmar labels for common place categories such as hotel, restaurant,
  café, shop, hospital, school, bank, religious place, park, and service
- refreshes reverse-address content for the selected language instead of
  retaining an older mixed-language snapshot

Place-detail validation:

- web production build: passed
- targeted ESLint: passed
- map regression suite: 135 tests passed
- whitespace validation: passed
