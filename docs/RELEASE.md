# Release contents and packaging

This is an accepted-artifact release of the Meaning Model paper, grammar
appendix, engine, and Book example. It is not a release of the entire local
research history and is not a claim of completed empirical evaluation.

## Included

- The paper and compact grammar appendix, both as PDF and buildable LaTeX.
- The shared Rust engine, MCP interface, reusable profiles, tests, and small
  examples. Existing wire, schema, and engine binary names are preserved;
  the public MCP package belongs to Meaning Model.
- The accepted *Book of Conditions*, as PDF, Markdown, model sources, authored
  Understanding nodes, and reproducible Rust import/render scripts.
- A digest-bound Life Simulation source snapshot for the MCP reading workflow.
  Life Simulation remains a separate paper and research program.
- Citation metadata and explicit implementation limitations.

## Excluded

The export does not contain Git history, private planning, research scratchpads,
model conversations, reviewer scores, obsolete manuscripts, previous Book
versions, earlier candidate databases, build caches, or installed dependencies.
The Book's event-linked construction rationales are part of its public model;
they are not transcripts of private reasoning or raw conversations.

The Book export includes its current text and linked model descriptions. A
fresh release import has its own source digests; it must not be represented as
the original authoring transaction.

## Produce the clean tree

```sh
make install
make release
```

`release-files.json` explicitly selects the public files. The exporter writes
to a new directory under `build/` and emits `RELEASE-MANIFEST.json` containing
file sizes and SHA-256 digests. It never copies `.git`, rewrites local history,
commits, configures a remote, or pushes. It does not overwrite an existing
export. `make release-export` repeats only the packaging step after checks
have already run.

The exported tree is a distributable source snapshot. Changes made after an
export require a new export.

`make npm-package` creates the separately installable MCP tarball, including
the Rust sources and the resources it reads. It does not publish to npm. See
`mcp-server/NPM-README.md` for installation and the explicit engine-build or
prebuilt-install step. Prebuilt installation requires the matching GitHub
binaries to be published first.

`.github/workflows/engine-release.yml` builds version-matched native engines for
Apple Silicon and Intel macOS, Linux x64 and Windows x64. It runs installation
and Rust/MCP smoke checks on each host and can prepare a **draft** GitHub release
only after all four jobs pass. Review those results before publishing the binary
release, then publish the matching npm package and Registry metadata. Local
packaging never publishes any of these channels.

Companion snapshots are bound to exact file digests. The recorded source
identity describes the bundled bytes, independently of later changes in the
companion repository.

## Licensing

The release owner selected MIT for original software and CC BY 4.0 for original
papers, documentation, authored model data, and the Book. See `LICENSE`,
`LICENSE-CONTENT`, and `NOTICE`; third-party material retains its own terms.

## Publication channels

Keep user-visible changes in `CHANGELOG.md` under Unreleased while preparing
them. At publication, give that entry the package version and actual UTC
publication date. Record upgrade requirements and remaining limitations; do
not infer a publication date from a Git commit or include private discussions.

The source repository is https://github.com/emergent-wisdom/meaning-model.
GitHub source snapshots, archival uploads, npm packages, and MCP Registry
listings are separate publications. The npm package guide describes the
package and Registry steps; neither is performed by the exporter.

Packaging does not establish a training result, comparative writing result,
or complete grammar-conformance claim.
