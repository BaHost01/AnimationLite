# Repository Guidelines

## Project Structure & Module Organization
This repository packages a Minecraft Bedrock addon as two packs:
- `BP/` contains behavior-pack logic, including `BP/scripts/main.js`, `BP/items/wand.json`, and `BP/manifest.json`.
- `RP/` contains resource-pack assets such as `RP/textures/items/wand.png`, `RP/textures/item_texture.json`, and `RP/manifest.json`.
- Root-level icons (`pack_icon.png`, `pack_icon.svg`, `wand.svg`) support packaging and branding.
- `.github/workflows/main.yml` builds distributable `.mcpack` and `.mcaddon` archives on push/tag.

## Build, Test, and Development Commands
There is no dedicated local build system or test runner in the repo. Use the workflow as the source of truth for packaging:
- `zip -r KeyframeLite_BP.mcpack BP/*` creates the behavior-pack archive.
- `zip -r KeyframeLite_RP.mcpack RP/*` creates the resource-pack archive.
- `zip -r KeyframeLite_Addon.mcaddon BP RP pack_icon.png` creates the combined addon bundle.
- When editing scripts, validate the pack structure manually by checking the manifest paths and file names the addon expects.

## Coding Style & Naming Conventions
Use the existing JavaScript style in `BP/scripts/main.js`:
- 4-space indentation, semicolons, and `const`/`let` over `var`.
- Keep Bedrock identifiers stable and descriptive, such as `keyframelite:wand` and `anim_<name>_f<index>`.
- Prefer short, direct function names for UI actions and pack logic.
- Keep JSON formatting consistent and avoid changing UUIDs unless you are intentionally regenerating pack identities.

## Testing Guidelines
Automated tests are not currently defined. Verify changes by:
- Checking that `BP/manifest.json` still points to `scripts/main.js`.
- Confirming `RP/textures/item_texture.json` matches the actual texture file paths.
- Loading the addon in Bedrock and exercising the wand, menu flow, and pack export paths.

## Commit & Pull Request Guidelines
Recent commits use short, imperative messages with a clear scope, for example: `Fix Discord file upload and Release trigger in GitHub Actions`.
- Keep commit messages similarly specific and action-oriented.
- Pull requests should describe what changed, why it changed, and any gameplay or packaging impact.
- Include screenshots or short clips only when UI, textures, or in-game behavior visibly changed.

## Security & Configuration Tips
Do not commit webhook secrets or other release credentials. The workflow expects secrets to be provided through GitHub Actions, not stored in the repository.
