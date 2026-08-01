# BOM Grid dependency provenance

| Package | Version | Registry | Repository tag commit | License |
|---|---:|---|---|---|
| `@revolist/revogrid` | `4.23.22` | `https://registry.npmjs.org/@revolist/revogrid` | `84a6ba8ad24305e446533202f2fe61b513edd353` (`v4.23.22`) | MIT |
| `react-data-grid` | `7.0.0-beta.61` | `https://registry.npmjs.org/react-data-grid` | `e01ce72cafd69fffaa98e6857018075662c721ff` (`v7.0.0-beta.61`) | MIT |
| `zod` | `4.4.3` | `https://registry.npmjs.org/zod` | `1fb56a5c18c27102dbc92260a4007c7732a0ccca` (`v4.4.3`) | MIT |
| `decimal.js` | `10.6.0` | `https://registry.npmjs.org/decimal.js` | `1a6e845004b29a3b7dcef78fe92b8d786634f4e2` (`v10.6.0`) | MIT |

Versions are exact in `package.json` and integrity hashes are committed in `package-lock.json`. The license audit copies available package LICENSE files into `artifacts/licenses/texts/`.

Upgrades require:

1. version and upstream commit update in this file;
2. regenerated lock file, SBOM, notices, and browser bundle inventory;
3. both grid labs rerun against the golden fixture;
4. IME, 300-row paste, save/readback, build, typecheck, and browser gates passing;
5. explicit confirmation that no Pro or differently licensed plugin entered the bundle.
