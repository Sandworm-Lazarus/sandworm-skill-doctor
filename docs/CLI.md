# Skill Doctor Node CLI

The dependency-free CLI uses **the same unchanged `dist/engine.js`** as the browser. It reads a selected package folder without executing its scripts, following links, importing code from it or opening external URLs. Node.js 20+ is required.

From the repository root:

```sh
node cli/skill-doctor.cjs check ./path/to/skill --json
node cli/skill-doctor.cjs snapshot ./path/to/skill --output ./before.json
node cli/skill-doctor.cjs compare ./before.json ./after.json --json
npm run doctor -- check ./path/to/skill
```

`check` and `compare` produce plain text unless `--json` is provided. `snapshot` always writes a JSON result summary to stdout and creates the snapshot at the explicit output path. Put output files **outside** the inspected folder. Existing output files are refused, including symlinks. No overwrite/force option is provided.

## Commands and exit codes

| Operation | 0 | 1 |
| --- | --- | --- |
| `check <folder> [--json]` | No error/warning findings; informational findings may remain | At least one engine error or warning |
| `snapshot <folder> --output <new-file>` | Snapshot written | Not used |
| `compare <before> <after> [--json]` | All snapshot entries unchanged | At least one added, removed or changed path |

Every command uses exit **2** for invalid arguments, unsafe paths, invalid UTF-8/schema or resource limits, and exit **3** for filesystem/output failures. Errors go to stderr with fixed codes/messages, without supplied path values, file contents, parser messages or OS exception text. A JSON error has `schema: "sandworm.skill-cli-error.v1"`.

Check JSON is the shared engine's `sandworm.skill-review.v1` report. Compare JSON is `sandworm.skill-diff.v1` with `added`, `removed`, `changed` and `unchanged` relative-path arrays. Snapshot files retain the existing `sandworm.skill-snapshot.v1` format and can be imported by the browser.

Snapshot creation captures selected bytes even when metadata would produce inspection findings. Run `check` separately when enforcing review policy. Exit 0 never establishes package safety.

## Filesystem scope

The folder is resolved to an absolute canonical root. Every traversed ancestor and package entry is checked with `lstat`; symlinks and Windows junctions are rejected, including links that point back into the package. File reads require regular files with a single hard link. Devices, sockets, FIFOs and other special entries are rejected before opening.

The adapter checks real-path containment and file/directory identity, uses `O_NOFOLLOW` for final files where the platform provides it, and repeats identity/containment checks around bounded reads. Input changes detected during reading are refused. Use a quiescent local folder: standard Node path APIs do **not** provide a race-proof directory-descriptor sandbox or an atomic snapshot of a concurrently hostile filesystem. The checks are defensive boundaries, not a filesystem security certification.

All package files are included. There are **no automatic ignores**, extension filters or network fetches. Choose the actual skill package directory, rather than a repository root containing `.git`, dependencies, binary assets or unrelated files. Failure rejects the complete operation; no partial inspection report is emitted.

Limits:

| Boundary | Limit |
| --- | ---: |
| Regular files | 64 |
| UTF-8 bytes per file | 128 KiB |
| Aggregate file bytes | 1 MiB |
| Relative path characters | 240 |
| Traversed entries, including directories | 256 |
| Nested directory depth | 16 |
| Imported snapshot bytes | 128 KiB |
| Matched Markdown references | 2,048 (shared engine) |

UTF-8 decoding is fatal on malformed sequences and preserves an initial BOM and line endings. Snapshot hashes therefore represent the original accepted UTF-8 bytes. Relative paths use forward slashes and retain exact Unicode/case; there is no case or Unicode normalization. Nonportable path syntax, control characters and bidirectional formatting characters are refused. Raw metadata and source text are omitted from reports, but relative names/hashes can still reveal package information.

Snapshot output uses exclusive creation and mode 0600 where supported. Parent paths must already exist and pass link/canonical checks. Write failure can leave the newly created partial file; an existing file is never replaced, and the CLI reports failure rather than a usable snapshot.

## Shared inspection limitations

The existing engine uses a one-line frontmatter subset, limited Markdown-link heuristics, a license-filename presence check and a remote-shell review pattern. It is not a full YAML/Markdown parser, license analyzer, malware detector or prompt-injection detector. Hashes show changed bytes; they are not signatures or proof of provenance. The browser's documented limits remain unchanged.

## Verification

[CLI tests](../tests/cli.test.cjs) create synthetic temporary package trees and invoke the real Node CLI. They cover shared-engine parity; finding/error exits; BOM/CRLF byte hashes; snapshot comparison and exclusive output; root/file/directory/ancestor symlinks; hard links; budgets; invalid UTF-8; sanitized reports; and refusal to execute a synthetic script. Link cases explicitly report unavailability when the test host cannot create links.

Run `npm run check` to execute the repository's Node suites and static checks. The feature workflow schedules Linux and Windows checks on push/PR. Hosted execution is pending verification; this document does not claim those native filesystem tests passed. Any recorded older validation report applies only to its own source digests.
