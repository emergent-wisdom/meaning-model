# Changelog

User-facing changes to the Meaning Model engine, MCP package, and bundled
artifacts. Released entries use package versions and UTC publication dates;
unpublished work stays under Unreleased. This is not a development transcript.

## Unreleased

No changes recorded.

## 0.2.0 — 2026-09-06

### Added

- Refine an existing world after accepted history, or explicitly revise its
  commitments. Both operations check the expected world head and preserve
  immutable before-and-after receipts with a reason and provenance.
- Native temporal Cut recomposition checks: complete duration-weighted
  partitions must reproduce their parent; partial detail must leave a feasible
  remainder. Compatible partial partitions can be completed without rewriting
  earlier children.
- An explicit `--install-engine` command for version-matched prebuilt engines,
  with SHA-256 verification and safe replacement. The release workflow builds
  and checks macOS arm64/x64, Linux x64, and Windows x64 binaries before preparing
  a draft release.
- A runnable progressive-authoring example, including rejection of detail that
  normalizes locally but contradicts its parent.

### Fixed

- Invalid uncertainty values on narrative nodes are rejected.
- MCP command payloads cannot replace reserved operation, schema, or request-ID
  fields.
- Meaning Model queries and estimation-change validation include normalized
  Cuts, context roots, and temporal recomposition contracts, using each
  collection's correct record identifier.

### Changed

- Exclude internal manuscript-maintenance files from future source exports;
  functional engine, model, and example tests remain included.

### Compatibility and limits

- Install or build the matching engine when upgrading the MCP package. Existing
  wire names are retained; models without the new optional temporal contracts
  keep their previous hashes. No automatic data conversion is performed.
- New processes need explicit values at the current world time. Existing process
  shapes and units cannot be changed by a world revision.
- Revision-spanning histories persist in SQLite, and their narrative graphs can
  still be rendered. Portable project/checkpoint and accepted-history training
  exports across those revision boundaries remain unsupported.
- Prebuilt installation supports macOS 14+ arm64/x64, Linux x64 with glibc 2.35+,
  and Windows x64. It needs matching published assets; normal startup never
  downloads or builds an engine. Other platforms can build from source.
- The Book text and paper PDFs are unchanged by these engine improvements.

## 0.1.1 — 2026-09-05

- Added official MCP Registry metadata and the listing
  `io.github.emergent-wisdom/meaning-model`.
- Clarified `npx` setup and the required path to an explicitly built engine.
- Updated package/version reporting. Rust behavior and bundled model resources
  were unchanged from 0.1.0.

## 0.1.0 — 2026-09-05

- Initial npm release of `@emergent-wisdom/meaning-model-mcp`, providing a
  stdio MCP interface to the Rust engine with 36 tools and eight resources.
- Bundled Rust sources, modeling resources, presets, and an explicit
  `--build-engine` command. Ordinary installation and startup did not build
  an engine automatically.
