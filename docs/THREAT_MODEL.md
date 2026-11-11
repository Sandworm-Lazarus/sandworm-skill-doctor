# Skill Doctor threat model

## Data flow and trust boundary

User-selected UTF-8 files or pasted text enter an in-memory browser data structure. The engine validates size/path constraints, inspects a limited metadata/link syntax, and hashes text with Web Crypto. Node tests use the same engine; a Node-only `node:crypto` fallback supports hashing there. There is no skill execution, installation, archive extraction, shell process, link fetch, or dependency resolution in the application.

The application requests no network connection for processing, stores no history, and uses a restrictive CSP with `connect-src 'none'`. Fonts are embedded WOFF2 data URLs in the local stylesheet. UI reports use text nodes, not HTML insertion. Reloading or clearing the page discards in-memory source data. Browser extensions, clipboard tools, crash recovery, an already compromised browser, and the hosting page's delivery chain remain outside the application's protection.

## Input boundaries

Selected-file limits are 64 files, 128 KiB each, 1 MiB aggregate, and 240 characters per path. Only decoded UTF-8 text is accepted; arbitrary binary packages and archives are unsupported. Inspection caps matched Markdown links at 2,048. Imported snapshots are at most 128 KiB. Paths are case-sensitive, duplicate paths are rejected, and traversal is rejected for selected-file names. Markdown references may ascend only within the selected package. No filesystem path is opened from a supplied reference.

A missing reference only indicates absence in the selected set. Selected files can be incomplete, mislabeled, modified, or authored by an attacker. License presence and metadata syntax checks establish no trust in a package. The tool does not detect all prompt injection, exfiltration, malicious dependencies, or runtime behavior. It must not be used as an installation authorization gate by itself.

## Exports and comparison

Exports contain file paths, lengths, digests, fixed finding codes/messages, and comparison categories. They omit raw file content and parsed name/description values. Paths themselves can reveal sensitive information; the UI requires review before export. Errors use fixed messages and do not echo source text or low-level parsing errors. This does not constitute universal PII detection.

SHA-256 snapshots are unsigned. Comparing two snapshots shows changes in the supplied data, not who authored the changes or whether either snapshot is authentic. Store trusted baselines separately. There is no remote validation or timestamp authority.

Changing source/package inputs invalidates the current report and export approval. Async imports/hash operations use a revision check so stale work is not published after an edit. Changing a baseline removes the old comparison and export approval.

## Supported launch

Serve the static directory over localhost HTTP or HTTPS so Web Crypto is available. The app contains no offline service worker or installation cache; opening an already loaded page without a network is not equivalent to an offline-first install. All assets are available in the repository for local serving.
