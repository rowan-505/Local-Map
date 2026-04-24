# Core Promotion Quality Rules

This document defines practical quality rules for promoting `staging` candidates into `core` for a Myanmar-focused map product. The goal is to keep core data trustworthy without blocking useful progress when source data is incomplete.

## Core Principle

- Promotion into `core` must favor correctness over volume.
- A candidate should not be promoted if the team cannot explain whether it is a new real-world feature, an update to an existing feature, or an unresolved duplicate.
- Imperfect source data is acceptable; ambiguous identity is not.

## General Promotion Threshold

- Promote only candidates that are explicitly approved for core promotion.
- Review identity first, geometry second, and metadata third.
- Missing optional metadata should not block promotion when the real-world entity is clearly identified.
- Unresolved duplicate risk should block promotion more often than missing enrichment fields.

## Place Rules

### When A Staging Place Candidate Should Create A New Core Place

- Create a new `core` place when no existing core place is a credible match by identity, location, and category.
- Create a new place when the candidate represents a distinct real-world place even if another nearby place has a similar name.
- Create a new place when reviewed evidence shows a separate entrance, separate business, separate landmark, or separate public feature.
- Create a new place when source lineage is clear enough to support later auditing and updates.

### When A Staging Place Candidate Should Update Or Merge Into An Existing Core Place

- Update an existing `core` place when the candidate clearly refers to the same real-world place.
- Merge when name variation, small geometry drift, or minor category differences do not indicate a separate entity.
- Merge when the existing place and candidate share strong identity signals such as matching name, same POI type, same approximate point, and consistent local context.
- Merge when the candidate adds better names, better geometry, better admin area linkage, or stronger source lineage to an existing place.
- Do not create a second core place just because the source uses a different spelling, language form, or slightly shifted point.

### How To Use `confidence_score` Operationally

- Treat `confidence_score` as a review aid, not an auto-promotion rule.
- High confidence supports faster review but does not replace identity checks.
- Medium confidence requires stronger manual review for duplicates, category correctness, and geometry plausibility.
- Low confidence should usually block promotion unless a reviewer has strong external evidence.
- Do not copy a staging candidate into `core` only because the confidence score is numerically high.

### How Nearby Duplicate Names Should Be Reviewed

- Nearby identical or highly similar names must be reviewed as potential duplicates before promotion.
- For Myanmar data, expect repeated names for tea shops, monasteries, schools, and local landmarks, so same-name alone is not sufficient to merge.
- Reviewers should check:
  - distance between points
  - category consistency
  - local admin area context
  - source references
  - whether the feature is a chain, campus, branch, or repeated generic label
- If the reviewer cannot confidently distinguish duplicate from separate feature, do not promote yet.

### How Category Mismatches Should Be Handled

- Minor category mismatch should not force a new core place if identity is clearly the same.
- If the existing core place is the same entity but the staging category is better, update the core category after review.
- Major category mismatch should trigger closer review because it may indicate a duplicate or bad source mapping.
- If identity is clear but category is uncertain, promote with the best reviewed category and keep the rest of the data simple in v1.
- If identity is not clear and category is also inconsistent, do not promote.

### How Missing Admin Area Linkage Should Be Handled

- Missing `admin_area` linkage does not automatically block promotion if the place identity and geometry are otherwise solid.
- Assign `admin_area_id` when a reviewed linkage is available.
- If a clear spatial or reviewed admin match exists, use it during promotion.
- If the correct admin area is uncertain, leave the nullable core link empty and resolve later.
- Do not invent an admin linkage just to satisfy completeness.

## Road And Street Rules

### How Roads And Streets Should Avoid Duplicate Insertion

- Do not insert a new core street if the candidate clearly represents an existing named street segment already in core.
- Review both name and geometry shape, not name alone.
- Small geometry updates or cleaned linework should usually update an existing street rather than create a duplicate.
- A new street should be inserted only when the candidate represents a genuinely separate street or clearly separate feature.
- Generic road names such as repeated local lane names require stricter geometry and context review before deciding insert versus merge.

## Transit Stop Rules

### How Transit Stops Should Avoid Duplicates By Geometry And Name

- Transit stops should be matched using both geometry proximity and reviewed name similarity.
- Same name with clearly different stop positions may represent different directions, platforms, or nearby but distinct stops.
- Very close points with the same or near-identical names should usually be treated as duplicate candidates unless review shows separate stop identities.
- If name is weak but the stop is in the same reviewed location and serves the same route context, prefer update over duplicate insertion.
- If directionality or platform distinction matters operationally but is not modeled well in v1, do not invent separate stops unless the distinction is confirmed.

## Bus Route Rules

### How Bus Routes Should Distinguish Route Vs Route Variant

- A `route` is the stable public route identity.
- A `route variant` is a specific geometry or directional shape for that route.
- Different geometry for the same public route code should normally create or update a route variant, not create a new route.
- Different route code usually indicates a different route identity unless review shows the source is wrong.
- Name cleanup alone should update route identity or route names, not create a new variant unless geometry or direction is also materially different.
- If the reviewer cannot tell whether the candidate is a route correction or a separate route identity, do not promote yet.

## Minimum Fields Required Before Promotion Into Core

### Places

- reviewed candidate identity
- `canonical_name`
- `poi_category_id`
- `point_geom`
- resolvable source lineage through `source_snapshot_id`

### Admin Areas

- reviewed candidate identity
- `canonical_name`
- `admin_level_id`
- valid polygon geometry
- resolvable source lineage through `source_snapshot_id`

### Streets

- reviewed candidate identity
- `canonical_name`
- valid line geometry
- resolvable source lineage through `source_snapshot_id`

### Bus Stops

- reviewed candidate identity
- `canonical_name`
- valid point geometry
- resolvable source lineage through `source_snapshot_id`

### Bus Routes

- reviewed candidate identity
- `route_code`
- `public_name`
- valid line geometry for the promoted variant
- resolvable source lineage through `source_snapshot_id`

## Fields That Can Remain Null Safely In V1

### Places

- `secondary_name`
- `name_local`
- `entry_geom`
- `footprint_geom`
- `plus_code`
- `admin_area_id` if linkage is uncertain
- contact fields

### Admin Areas

- `parent_id` when hierarchy is not yet confidently resolved

### Streets

- `admin_area_id` when unclear

### Addresses

- `house_number`
- `unit_number`
- `postal_code`
- point or entrance geometry where not known

### Transit

- `operator_name`
- `route_type`
- `directionality`
- `direction_name`
- `origin_name`
- `destination_name`
- `distance_m`
- `stop_code`
- `admin_area_id` when unclear

## Practical Blocking Conditions

- Do not promote when the candidate is likely a duplicate and unresolved.
- Do not promote when geometry is obviously wrong for the intended entity type.
- Do not promote when core linkage fields point to the wrong real-world entity.
- Do not promote when source lineage is too weak to support later auditing.
- Do not promote when review cannot explain whether the action is insert, update, or merge.

## Practical Acceptance Conditions

- Promote when the entity is clearly real, correctly typed, and review has resolved duplicate risk.
- Promote when required fields are present and optional enrichment can safely wait.
- Promote when source lineage is preserved well enough for future correction and auditing.
- Prefer a slightly incomplete but correct core record over a richer but questionable one.
