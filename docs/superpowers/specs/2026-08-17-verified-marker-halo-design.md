# Verified Character Marker Halo Design

## Goal

Keep a verified user's live tracked character marker easy to identify without displaying a `ME` badge or making the marker dominate nearby player markers.

## Design

- Remove the visible `ME` element and its dedicated label styling entirely.
- Retain the `native-map-marker--current-user` ownership class, coloured double halo, glow, and reduced-motion treatment.
- Reduce the owned marker container and content from 34px to 28px.
- Reduce its centre dot from 12px to 10px while retaining the stronger border.
- Preserve the marker's resolved generated or custom player colour.
- Preserve the `Your character, …` tooltip, title, and accessible label.
- Preserve the existing eligibility rules: only an approved exact linked-character ID that is already tracked and has a live returned position receives the ownership treatment.

## Scope

This is a frontend-only map presentation change. It does not alter tracking, account settings, colour preferences, routing, APIs, persistence, or dedicated-map behavior.

## Verification

- Update the map boundary test to reject visible `ME` marker markup and require the 28px container/content plus 10px dot.
- Run the focused map boundary test.
- Run the production build.
- Browser-smoke the authenticated live marker when practical, confirming the halo remains clear without visible badge text.
