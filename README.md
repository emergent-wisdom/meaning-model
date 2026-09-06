# The Meaning Model

**Construct worlds coarsely, then develop the parts that matter.** The Meaning
Model connects world records, concepts, descriptions, understanding, and story
text in one addressed representation. Finer detail must respect an accepted
account or revise it explicitly.

This repository brings together the theory, its compact grammar appendix, the
Rust engine and MCP interface, and *The Book of Conditions*, a worked
construction with a complete twelve-chapter manuscript.

See the [changelog](CHANGELOG.md) for release changes, upgrade notes, and
unreleased work.

## Read first

- [Meaning Model paper](output/pdf/meaning-model.pdf) - the argument, grammar,
  construction method, examples, and numerical portrait.
- [Grammar appendix](output/pdf/meaning-model-grammar.pdf) - a focused reference
  to the same rules, not a separate theory or additional set of requirements.
- [The Book of Conditions](output/pdf/the-book-of-conditions.pdf)
  - the completed story; [Markdown and model sources](examples/book-of-conditions/README.md)
  are also included.

The six world-record forms are Concept, Thing, Event, Binding, Cut, and
Realization. A Cut divides one declared unit among exclusive sibling answers
and an explicit remainder; its weights sum to one. Ordinary process links are
unweighted. Dates, money, counts, and physical measurements keep their external
units. Understanding Nodes and Document Nodes share the address space without
acquiring the authority of accepted world facts.

## Try it

The smallest demonstration requires only Node.js:

```sh
node --test examples/refinement-trial/example.test.mjs
```

It shows a refinement that fits its parent, a locally valid refinement that
contradicts the parent, and an explicit revision. The example is synthetic,
not evidence that the full implementation or learning proposal is complete.

For the Rust engine and MCP tools, install Rust/Cargo, Node.js 22.18 or newer,
and npm, then run:

```sh
make install
make build
make test
```

For a native example, run `node examples/progressive-authoring/run.mjs` after
building. [Progressive authoring in Rust](examples/progressive-authoring/README.md)
opens a Cut after accepted history, rejects incompatible detail, completes a
partial temporal contract, and explicitly revises and continues the same world.

Start the MCP server after building:

```sh
cd mcp-server
npm start
```

See the [MCP guide](mcp-server/README.md), [engine guide](rust-engine/README.md),
and [modeling protocol](docs/MODELING_PROTOCOL.md). Existing `life-sim` command,
schema, resource, and binary identifiers are retained for compatibility with
saved artifacts. They do not identify a second engine.

The package name is
[`@emergent-wisdom/meaning-model-mcp`](https://www.npmjs.com/package/@emergent-wisdom/meaning-model-mcp).
Its official MCP Registry identity is `io.github.emergent-wisdom/meaning-model`,
described by [`server.json`](server.json). Registry-based clients must supply
the path to an explicitly installed or built engine. Install the engine matching
the package version. `meaning-model-mcp --install-engine` explicitly downloads
and verifies that version's published release engine. Alternatively, use
`meaning-model-mcp --build-engine` to build the included Rust source.
Neither npm installation nor normal server startup downloads or builds an
engine. To prepare a local npm tarball, run `make npm-package`. See the
[package installation guide](mcp-server/NPM-README.md). Creating a tarball does
not publish it or establish ownership of the npm scope.

## What is demonstrated

The Book is a bounded example of model-assisted authorship: macro accounts,
complete lives, local Cuts, event descriptions, linked construction rationales,
and prose were developed and revised together. Its accepted sources can be
imported into Rust and the manuscript rendered from document nodes. That
retrospective import is not a recovered transaction log of the original
authoring process.

The engine implements typed records, immutable revisions, persistence,
candidate acceptance, normalized Cuts, and bounded narrative graph operations.
Optional temporal Cut contracts check explicit answer projections and duration
mixtures, including whether partial detail leaves a feasible remainder.
An accepted world can move to its direct next model revision after time has
advanced, with an explicit refinement or revision, a compare-and-swap check,
and an immutable receipt preserving both heads. Portable narrative training
and project checkpoint exports across that revision boundary remain unsupported;
the session database retains the complete history.
It does **not** implement every contract in the paper. The
[implementation boundary](docs/IMPLEMENTATION.md) distinguishes implemented
checks, authoring conventions, and missing behavior. The preregistered matched
comparison and independent read-back study remain prospective. Neither a
passing validator nor an authored numerical portrait establishes historical
truth, psychological validity, or an advantage over ordinary writing.

## Repository map

| Path | Contents |
| --- | --- |
| `paper/` | Paper and appendix sources, shared style, figures, bibliography |
| `rust-engine/` | Shared Rust implementation, optional numerical simulation capabilities, tests and examples |
| `mcp-server/` | MCP interface to that engine |
| `profiles/` | Reusable authoring conventions, not mandatory human categories |
| `docs/` | Operational documentation and implementation limits |
| `examples/refinement-trial/` | Small standalone construction example |
| `examples/progressive-authoring/` | Native temporal refinement, explicit revision, and continued world history |
| `examples/book-of-conditions/` | Accepted Book, model sources, rationale nodes, and reproducible export |
| `output/pdf/` | Ready-to-read paper, grammar appendix, and Book PDFs |

Meaning Model owns the representation and joint construction method. The
separate **Life Simulation** project studies process-history generation,
inference, learning, and their empirical evaluation. It consumes this engine;
it does not maintain a second implementation. A digest-bound copy of its paper
is included only as a companion MCP reading resource under
`docs/companions/life-simulation/`.

## Build the documents

With `latexmk` and a LaTeX installation containing the imported packages:

```sh
make paper
make grammar
make book
```

To check the code, examples, resources, and documents together:

```sh
make check
```

## Release packaging

`make release` checks and builds the package, then exports an allowlisted clean
directory beneath `build/`. The export includes the three PDFs and their
sources, but not `.git`, build caches, private planning, review transcripts,
or earlier constructions.

See the [release guide](docs/RELEASE.md) for packaging and provenance details.
Exporting files does not push to GitHub or publish a package.

## License and citation

Original code is [MIT licensed](LICENSE). Original papers, documentation,
authored model data, and the Book are [CC BY 4.0](LICENSE-CONTENT).
[NOTICE](NOTICE) preserves the boundary for third-party material.
[CITATION.cff](CITATION.cff) identifies the author and preferred paper citation;
the repository URL is recorded there, and a DOI will be added when assigned.
