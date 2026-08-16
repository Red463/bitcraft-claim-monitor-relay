# Watchtower Map Icon Replacement

## Goal

Replace the watchtower marker artwork on the map with the supplied transparent PNG while preserving all existing map behavior and sizing.

## Design

- Replace `apps/bitcraft-local/public/map-icons/claims/watchtower.png` in place with the supplied `watchtower.png`.
- Keep the existing public URL, React marker presentation, CSS, and 24×24 rendered marker size unchanged.
- Preserve the asset contract: PNG format, transparent background, and 450×450 source dimensions.
- Do not change watchtower data, marker interaction, labels, or the Empires page.

## Verification

- Confirm the repository asset matches the supplied file by SHA-256 and remains a 450×450 transparent PNG.
- Run the BitCraft Local production build.
- Inspect the focused diff and confirm no unrelated files are included in the release commit.
- After deployment, confirm production reports the new version and the served watchtower asset matches the supplied SHA-256.
