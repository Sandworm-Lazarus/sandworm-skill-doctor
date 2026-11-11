# Development record

## v0.1.0 — 2026-11-11

Original implementation for the Sandworm tool collection:

- Buildless Thai browser UI with a dark navy/coral theme, responsive input/review/comparison panels, embedded local fonts, and original network artwork.
- Shared browser/Node inspection engine with explicitly limited one-line frontmatter, local reference checks, license-file presence, and a shell-command review heuristic.
- Deterministic SHA-256 snapshots of exact UTF-8 file content, sorted by case-sensitive relative path. Added/removed/changed/unchanged comparison and strict imported snapshot field validation.
- User-selected file/folder import, sample package, clear operation, fixed error messages, stale-async-result rejection, and review-gated JSON export.
- Synthetic fixture packages exercised by the tests, plus a validation receipt containing source and fixture SHA-256 digests.

## Local verification

45 tests (33 engine and 12 controller tests) passed locally with Node.js 24.22.1. Controller regressions cover stale imports/hash results, review gating, sanitized exports, and preservation of imported BOM/CRLF despite textarea display normalization. They cover metadata boundaries, unsupported syntax, paths, UTF-8 byte limits, selected-file counts, link resolution, missing licenses, known SHA-256 vectors, deterministic ordering, newline sensitivity, snapshot validation, comparison categories, and absence of source payloads in reports/errors.

```sh
npm test
npm run check
```

The test count is recorded by the command output rather than represented as hosted CI success. Browser/device checks and hosted CI are separate observations; this document does not claim a full browser compatibility matrix. The original feature implementation deliberately avoids a YAML or Markdown parser dependency by documenting the smaller grammar it actually examines.

## Extending responsibly

Add any new grammar or signal with fixtures for both matches and legitimate look-alikes. Preserve stable sanitized errors and input limits. A future full YAML/Markdown parser would need explicit dependency/version handling and parsing budgets. Never execute imported skills as part of inspection. Signed provenance and runtime isolation are distinct features and are not supplied by the current snapshot mechanism.
