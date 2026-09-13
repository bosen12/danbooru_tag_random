# Sports preset consistency design

## Goal

Make sports presets preserve user-owned pins, use one explicit compatibility model, emit only verified Danbooru/WAI-suitable tags, and prevent boxing gloves from pairing with actions that require free fingers.

## Decisions

1. `presetOwned` records only tags added by the most recent named preset. Switching or disabling removes only those tags. Legacy saves migrate to `null`; ownership is never inferred from a full kit because the same tags may have been pinned manually.
2. `SPORT_TAG_SCOPE` explicitly declares exclusive/shared sport identity. Unlisted tags are neutral. `SPORT_VENUES` declares sport-compatible venues, and `SPORT_ACT_PLACE` is derived from it.
3. `ski slope` is removed everywhere. Skiing uses `mountain`; its existing implication supplies `snow`.
4. Volleyball, badminton, and table tennis use the older `school gym` as their pinned venue. `sports court` remains a compatible candidate but no longer implies `outdoors`; `fitness gym` is removed from sport activity venue lists.
5. Only worn hand blockers (`boxing gloves`) occupy hands. Scene props such as rackets, bats, clubs, and bows do not. Automatic draws reject free-finger actions with occupied hands; explicit conflicting pins remain and produce a warning.
6. `allSportTags()` is the only verifier inventory. It includes preset activity/venue/equipment/clothing/optional equipment and every derived compatible venue.
7. The verifier records `created_at` and accepts optional `--max-created <year>`. Newer tags are warnings, not invalid-tag failures.
8. A saved `settings.pinSportActivity` toggle, default off, controls whether clicking a sport also pins its activity. Existing heat-driven behavior remains the default.

## State flow

- Applying a preset first removes `presetOwned.tags`, then applies the new preset and records the set difference as its ownership.
- Toggling an active preset removes only its recorded owned tags. A partial preset is completed without losing manual pins.
- Manually removing an owned tag also removes it from `presetOwned.tags`, so later switching cannot delete a tag that the user subsequently re-added manually.
- Clearing all pins clears `presetOwned`.

## Compatibility semantics

- `sportIdsOf(tags)` intersects only declared scopes; no scoped tags returns `null`.
- `sportTagAllowed(tag, used)` always allows neutral tags; scoped tags require a non-empty intersection with existing scoped tags.
- Every venue compatible with a sport is declared once in `SPORT_VENUES`; activity-place maps are derived from preset activity plus venue membership.

## Error and compatibility policy

- Explicit user pin conflicts are preserved and reported.
- Legacy localStorage is lossless: missing or malformed `presetOwned` becomes `null`.
- Current Danbooru validity and model-vocabulary age are separate checks. Creation-year warnings never claim a WAI training cutoff.

## Verification

- Regression tests for preset ownership, legacy migration, shared/neutral sport scopes, invalid ski tags, hand occupation, verifier inventory, and the activity-pin setting.
- Property tests ensure compatible venue/sport pairs are accepted and neutral tags never constrain identity.
- Full engine, quiz, shadow, gold/eval, server, syntax, and live Danbooru verification are run before completion.

