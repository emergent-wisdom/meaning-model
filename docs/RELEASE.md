# Release preparation

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

Use this exported tree for the later clean initial commit to the selected
GitHub organization. Do not push the current development repository's history.
Changes made after an export require a new export.

`make npm-package` creates the separately installable MCP tarball, including
the Rust sources and the resources it reads. It does not publish to npm. See
`mcp-server/NPM-README.md` for installation and the explicit engine-build step.

The public Meaning Model and Life Simulation repositories must each begin with
one initial commit. Create both remote repositories empty: do not initialize
them with a README, license, or other commit. After the destination URLs are
confirmed, initialize Git only in the two final exported trees, commit their
complete contents once, add the respective remote, and push that initial
commit. No rebase, force-push, or deletion of development history is needed.
Do not run these publication steps against the development checkouts.

Companion snapshots are bound to exact file digests. They do not claim to come
from a development commit and do not require circular references between the
two future initial commits. Assigned repository URLs and archival identifiers
can be included in the exports before their initial commits.

## Licensing

The release owner selected MIT for original software and CC BY 4.0 for original
papers, documentation, authored model data, and the Book. See `LICENSE`,
`LICENSE-CONTENT`, and `NOTICE`; third-party material retains its own terms.

## Before publication

The GitHub destination is https://github.com/emergent-wisdom/meaning-model.
It is private during release preparation; uploading the initial commit does
not make the repository public or publish an archival or npm release.

Before public publication, the release owner still needs to confirm:

1. The public release date and any archival identifier. Add those to the
   citation metadata and manuscript only when assigned.
2. Access to the npm scope for publishing the generated MCP package. A local
   package check does not verify account ownership or publish anything.

The two pre-relocation repository checkpoints preserve the development state
locally. They are recovery points, not a history to include in the public
initial commit. No training result, comparative writing result, or complete
grammar-conformance claim is created by this packaging step.
