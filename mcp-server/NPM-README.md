# Meaning Model MCP server

`@emergent-wisdom/meaning-model-mcp` exposes the Meaning Model's Rust engine
through MCP over stdio. The package includes JavaScript, Rust source and its
lockfile, modeling profiles, versioned paper resources, and checked presets.
It contains no prebuilt engine or build cache.

See the [changelog](CHANGELOG.md) for release changes and upgrade notes.

## Open your model

Version 0.4.0 includes the browser viewer in the MCP package.

After installing this MCP and its matching engine, connect it to your assistant as
usual. Ask **“Open the model we are working on”** or **“Show me this story.”** The
assistant calls `life_model_viewer_open` with the model or graph revision and returns
a local link. Open that link in your browser. No separate viewer installation,
GitHub checkout, run transcript or website account is needed.

The viewer shows the selected saved revision without changing it. Stories with
calendar dates and numeric paths can use the processes, tree and terrain views;
other models open a record inspector with their original units. Ask
the assistant to open the model again after changes to see the new revision.

Select a part on the reading-position track, or use Previous/Next, to highlight
its document and model links without changing world time. **Read this part** opens
the full manuscript at that section; **Read full story** opens it at the beginning.
Linked dates remain separate from document position and do not establish what a
reader knows. Optional Document spans follow authored passage boundaries after
edits and display unresolved boundaries explicitly.

The browser and MCP must run on the same computer. The link lasts while that MCP
process runs; its sixteen most recently opened views remain available. This is a
complete author view, requiring the supplied `accessScopes` to cover every scoped
record in the exported model and graph. Partial access is refused rather than
presented as a complete model. Opening a viewer does not publish the model.

## Three workflows in one server

One MCP server covers three kinds of work over the same engine and graph:

- **Modeling.** General-purpose, revisable world models of whatever you choose
  to model, such as a market, an institution or a technology, with an optional
  Jev estimator for cheap first estimates. See
  [general-purpose modeling](#general-purpose-modeling-and-optional-jev-estimation).
- **Narration.** The storytelling add-on writes fiction from a model, with an
  author model, whole-life character trends, scene review, alignment audits and
  deepening passes. See the [storytelling add-on guide](profiles/STORYTELLING_ADDON.md).
- **Ideation.** The alien add-on searches for solution mechanisms through
  invented worlds, following *Ontology of the Alien*, and curates them into a
  revisable map of idea families. See the [alien add-on guide](profiles/ALIEN_ADDON.md).

Modeling is always available; the two add-ons are opt-in with
`MEANING_MODEL_ADDONS`. Each workflow keeps what it does as revisable,
inspectable structure. None of them turns an estimate, a review or an idea into
evidence.

## The construction record

The model and its Understanding Graph are the modeler's understanding, not a report
about it: what is done and not recorded cannot be picked up by the next agent. Every
Event that carries a Cut has a description of what happens in it, so its numbers mean
something. Choices, ideas, predictions and voice decisions are recorded as
Understanding Nodes linked to the events, Cuts and passages they concern, and outside
reviews are recorded under their actual reviewers. `life_model_outline` shows the
present state with its notes at a chosen depth, and `life_construction_replay` replays
the whole development step by step, each note beside the records as they were when it
was written. A model that continues someone else's story or model replays it first.
`life_construction_export` and `life_construction_import` carry the whole history to
another engine with the same hashes, so the worked examples can be replayed anywhere.

## Model what your application needs

Choose your own processes, categories, relationships, and depth. Begin with
one process, use a supplied starter, or author a model directly. A complete
person model, the Book's vocabulary, and the optional semantic, narrative,
and decision layers are not prerequisites for every application.

The AI modeler can use this external model to connect evidence, compare
explanations, explore possibilities, and guide further inquiry. It also chooses
when to replace or refine its categories. The engine checks supported structure
and preserves explicit revisions; it does not choose a universal psychology.
Some templates load structure, while Story and Decision compile particular
experimental behavioural assumptions. Choose them deliberately. See the
[application guide and revision example](docs/examples/APPLICATION-CATEGORIES.md).

## General-purpose modeling and optional Jev estimation

Start with `life_general_modeling_start`. The general workflow supports
domain-defined processes across technology, adoption, institutions, markets,
physical systems and other applications. `life_world_model_build` constructs
the initial model and graph from a compact scaffold. Its required context review
starts with the enclosing system and longer-term developments before focal
processes; represented context, unknowns and justified exclusions become
Understanding Nodes. It also requires consideration of authored numerical
judgments, useful native conceptual decomposition, and meanings across dates or
perspectives. The agent may explain why a dimension is unnecessary or unresolved;
the tool does not demand arbitrary scores or depth. These checks do not prove
completeness or causal relevance.
The builder's preview can evaluate Jev
`initialEstimate` questions; applying that exact proposal adopts the initial
values as estimates without another provider call. `life_process_estimate`
uses bounded questions to create typed process-value proposals;
`life_process_estimation_record` saves the exact proposal, process records and
review in the graph. Estimates retain their status and evidence, and do not
silently become observations in accepted runtime history.

Set `MEANING_MODEL_ESTIMATOR=typesafe` and `TYPESAFE_API_KEY` to use Jev for
batched structured judgments. This is independent of the storytelling add-on
and is off by default. The LLM chooses the scope and questions; tool code
handles repetitive record construction. Reduced end-to-end cost and latency
require measurement, including setup and review work.

Read `life-sim://guide/general-modeling` for the complete workflow and limits.

## Install

Install the package and matching engine together. Prebuilt installation needs
the matching published GitHub release assets; a candidate without those assets
can use the explicit source build below.

In a directory where you want to keep the installation, run:

```sh
npm install @emergent-wisdom/meaning-model-mcp@0.4.0
npx meaning-model-mcp --install-engine
```

Node.js 22.18 or later is required. The explicit `--install-engine` command
downloads the executable for this package's exact version from the official
[`emergent-wisdom/meaning-model` GitHub release](https://github.com/emergent-wisdom/meaning-model/releases).
It supports macOS 14+ on Apple Silicon or Intel, Linux x64 with glibc 2.35+
(for example Ubuntu 22.04+), and Windows x64. It needs no Rust compiler.
Other platforms can use the source build or an existing compatible engine.

The installer checks the exact release tag, target, size and SHA-256 digest
reported by GitHub's release API before replacing the package's default
`rust-engine/target/release/life-sim-engine` executable (`.exe` on Windows).
Downloads are bounded and use GitHub HTTPS URLs; replacement is atomic, and a
failed download or checksum check preserves the previous executable. The
installer never writes to the `LIFE_SIM_ENGINE_BIN` override. Close a running
engine before reinstalling on Windows, where a process can lock its executable.

This verifies integrity against the official GitHub release channel. It trusts
GitHub and the repository's release maintainers; it is not independent author
signing, OS code signing, notarization, or proof of reproducible builds. A SHA-256
file is also published with each executable for manual checking. The automated
installer requires GitHub's own asset digest instead of trusting only that file.

npm installation and ordinary MCP startup never download or build an engine.
Run `--install-engine` again after installing a new package version. If the
matching release is unavailable, the installer fails explicitly. To build the
included source instead, run:

```sh
npx meaning-model-mcp --build-engine
```

The source build requires Cargo, a C compiler, and native build tools. It may
fetch dependencies pinned by `Cargo.lock`; Rust dependencies include bundled
SQLite. Alternatively, set `LIFE_SIM_ENGINE_BIN` to a compatible engine already
built for this machine.
For a release-candidate test, replace the package name with the path to the
reviewed `.tgz`; use `--build-engine` until that candidate's release assets exist.

## Connect

After installing or building the engine, point an MCP client at the installed launcher:

```json
{
  "mcpServers": {
    "meaning-model": {
      "command": "node",
      "args": ["/absolute/path/to/node_modules/@emergent-wisdom/meaning-model-mcp/mcp-server/bin/meaning-model-mcp.mjs"]
    }
  }
}
```

The default command serves only MCP on stdio. Run `meaning-model-mcp --help`
for setup options. Existing `life_*` tools, `life-sim://` resource URIs,
serialized schemas, `LIFE_SIM_ENGINE_BIN`, and the `life-sim-engine` binary
retain their compatibility names.

### Optional storytelling add-on

Scenes can contain ordered, independently editable passage nodes. The shared
`life_narrative_edit` tool supports split, merge, move, reorder, and exact text
replacement while preserving earlier graph revisions and the frozen source.
It reports affected reviews for reassessment and is available without the
storytelling add-on as well.

The package includes opt-in structure exploration, overall character life
trends, model-depth review, scene preparation, review, and commitment, plus advisory chapter or
section purpose review. To enable
them, add `MEANING_MODEL_ADDONS` to the server configuration:

```json
{
  "mcpServers": {
    "meaning-model": {
      "command": "node",
      "args": ["/absolute/path/to/node_modules/@emergent-wisdom/meaning-model-mcp/mcp-server/bin/meaning-model-mcp.mjs"],
      "env": {
        "MEANING_MODEL_ADDONS": "storytelling"
      }
    }
  }
}
```

Use `"storytelling,alien"` to enable the alien ideation add-on as well, or
`"alien"` alone. Keep any existing `LIFE_SIM_ENGINE_BIN` in the same `env`
object, and restart the MCP server. To let TypeSafe's Jev score the estimator tools
(`life_estimate_cut_shares`, `life_model_ingest`, `life_narrative_alignment_audit`) instead of
returning their questions to you, add `MEANING_MODEL_ESTIMATOR: "typesafe"` and
`TYPESAFE_API_KEY` to the same `env`; with that setting the text given to those
tools is sent to TypeSafe. Everything else stays local. The add-on exposes twelve tools: `life_story_structure_explore`,
`life_story_trajectory_explore`, `life_story_trajectory_revise`,
`life_story_author_record`, `life_story_life_trends`,
`life_story_model_depth_review`, `life_story_model_depth_record`,
`life_story_scene_prepare`, `life_story_scene_review`,
`life_story_scene_commit`, `life_story_purpose_review`, and `life_story_deepen`, plus the
`life-sim://addon/storytelling` resource and the `life_story_scene_start`,
`life_story_structure_explore`, `life_story_purpose_review`, and `life_story_deepen` prompts.
It uses the existing engine and narrative store. No extra package is needed.

The narrative graph is the authoritative authoring record. Create the model
and graph before developing story material; store candidates, seed draws and
alternatives, drafts, assessments, selections, local revisions, and disclosure
plans through the tool. Files and PDFs are exports of graph content, not a
parallel manuscript or model. Use `life_story_author_record` for authoring
material and concise Understanding Nodes. Numerical exploration and revision
persist their results directly; neither accepts them as world facts.

For new work the LLM develops or reuses an author model, using supported real
material or an explicitly invented persona within the human's delegation.
The author at composition time, their writing history and reasons for this
work inform concrete writing choices. The author, narrator and characters
remain distinct. After drafts and substantive revisions, the LLM assesses the
author's voice and each relevant principal character using actual passages
and model process evidence. It records intended versus observed effects,
uncertainty, and the smallest repair or a reason to keep the text through
`life_story_author_record`, `kind: "assessment"`, as actual Understanding Nodes
with reviewed hashes and evidence links. An external review alone is
insufficient; literary effectiveness remains advisory.

`life_story_deepen` prepares a later revision round of an existing work. It
binds the baseline graph, model, rendered text and selected author model, with
depth and purpose-review tasks. Default `revisionScope: "local"` preserves
premise, cast and ending; `structural` permits justified larger changes within
the agreed brief. The LLM saves before-analysis, a revision plan and
after-analysis as Understanding Nodes and uses existing tools to revise.
Keeping successful work is valid; there is no reroll or length quota. The
tool and same-named prompt are read-only and do not certify improvement.

Because scene commit appends, replacement uses an immutable graph successor:
retire superseded prose from rendering, remove or rewire active `contains` and
`next` placement, prepare/store/review/commit fresh scene IDs, and restore the
intended position. Review the exact final rendered topology for duplicates,
gaps and changed order, preserve the baseline, and never export an intermediate
gap as the finished revision.


The calling LLM automatically constructs or reuses the principal cast's overall
life trends before drafting scenes; the user need not request the step or
fill in a dossier. Store a new dossier with `life_story_life_trends` when
needed. It validates and stores authored coarse life
phases, trends across those phases, and explanations for their
developments. The scene workflow requires this dossier and connections from
each present or affected principal character to relevant trends; review findings address
their continuity with the prose. Missing dossiers and incomplete structures
are rejected. The LLM must still create a substantive model and interpret the
draft. A brief character sketch or the immediate crisis is not the intended
scope, and an undecided later life can remain open.

Before prose and after consequential model, trajectory, causal, or disclosure
revisions, the LLM automatically reviews whether the model explains the
story's consequential choices and outcomes. `life_story_model_depth_review`
reads the actual bound model and stored focus, life dossier, and selected
context. `life_story_model_depth_record` saves a coverage explanation and
findings as a scoped Understanding Node, with validated references to graph
nodes or model JSON Pointers. Relevant lives and flaws, concepts, constraints,
institutions, causes, and disclosure processes can be examined without a
fixed taxonomy or depth quota. Preserve adequate detail; repair the smallest
explanatory gap and reassess.

Scene preparation requires `modelDepthReviewNodeId` for a current
assessment covering its source, life dossier, and context. Changed evidence
requires reassessment; unrelated author notes or drafts do not. Missing or
stale records fail preparation; unresolved findings produce a packet with a
commitment blocker. Assessments and drafts can be saved while gaps are
resolved. This is a check on
the authored explanation, not a literary-quality score. The model read is
administrative, not filtered by narrative scopes, and its initial values are
not current world values. The LLM must identify missing evidence honestly.

When rebinding the narrative graph after a model revision, retain old depth
assessments as historical records but remove their predecessor-model anchor
edges from the successor through `life_narrative_revise`. Prior immutable
graphs retain the exact evidence. Never retarget old findings to new values;
record a fresh review with new model anchors before affected scene commitment.

Numerical trajectory exploration samples actual candidate values at selected
event or whole-life points, including emotional dimensions. The LLM defines
axes with explicit meanings, comparison questions, units, and bounds, then
supplies expected baselines and fixed values. Optional disjoint allocation
groups retain their declared totals. `randomness` (0–1, default 0.5) controls
variation; `candidateCount` (default 3, maximum 8) separately controls how many
possibilities to explore. A seed enables replay.

The LLM reviews coherence and storytelling potential and can repair a promising
candidate with `life_story_trajectory_revise` rather than discard the character.
Local revisions bind the parent hash and reasons, preserve unlisted and fixed
values, and check bounds and allocation totals. Retain original samples and
revision history. Category or point-time changes require an explicit new
proposal. Character dossiers can retain `trajectoryProposal: {definition,
candidate}` with `trajectoryRecordNodeId` as numerical evidence, with prose
summaries explaining the values. Storage verifies the exact candidate against
that graph record and preserves its access scopes.
Candidates are unaccepted creative hypotheses, not physical simulations or
calibrated psychological measures.

Record concise assessments and revision reasons as Understanding Nodes through
`life_story_author_record`, under its named author-understanding root. Use
`externalized_reflection`, a holder, author scopes, excluded rendering, and
specific `about`, `refines`, or `supports` links to the relevant evidence.
These are authored explanations, not hidden model reasoning or accepted world
facts. Numerical revisions persist their reasons automatically; the LLM records its
evaluations separately. The tools do not make literary judgments.

Structure exploration draws from a bounded bank of common English words, or
uses a caller-supplied word, to help the calling LLM propose possible events,
characters, relationships, storylines, or names. For new principal-character,
place, or organization names, the LLM automatically uses `targetKind: "name"`
and omits `seedWord` to draw a random inspiration. Supply culture, language,
genre, tone, and existing names as context; use sound, rhythm, or associations
to develop names that fit. Preserve established names unless a change is
requested, and distinguish invented etymologies from real linguistic facts.
The bank remains 160 reviewed words, not the STLM vocabulary. Record the seed task and proposed alternatives with `life_story_author_record`;
proposals remain unaccepted.

The calling LLM automatically performs purpose review after completed chapters,
significant turning points, completed parts or works, and consequential
revisions. A scene commit's `nextStep` reminder is conditional: the LLM decides
whether the relevant unit has finished. Supply context for life trajectories,
expectations, causes, aftermath, and authored disclosure. Review remains
qualitative and advisory; keeping the text unchanged is valid, and missing
context may leave the result unclear. There is no rewrite quota or review
timer. Random-word exploration and purpose review return tasks for the calling
LLM rather than invoking another model. Numerical exploration persists actual
samples for that LLM to interpret. Depth-recording persists the LLM's findings;
depth preparation does not invoke another model or produce its own verdict.

Optional anticipation, focal change, and adaptation Events already exist in
the core `change_arc_scaffold`. Their use does not impose a three-beat story:
shock can be welcome or expected, and adaptation can begin beforehand, overlap,
or remain incomplete. Model character experience separately from author
processes for intended reader anticipation and surprise.

With the variable unset, the server's default surface is unchanged. The shared
model and laws remain general-purpose, and existing low-level tools remain
available. See the [storytelling add-on guide](profiles/STORYTELLING_ADDON.md)
for the workflow and the distinction between mechanical checks and authored
prose-review findings.

### Optional alien add-on

Set `MEANING_MODEL_ADDONS=alien` (or `storytelling,alien`) to add world-diversity
ideation from *Ontology of the Alien*. The server writes each role's task with
only what that role may see:

- a target-blind builder turns a seed word into an invented world;
- a purpose-blind solver solves the problem inside that world;
- a compiler brings the operative mechanism back into the problem's domain.

The paper is bundled and must be read before a search: the write tools refuse
until it has been read in the MCP process. Every cell of the paper's condition
matrix can be run, from direct proposals with a Semantic Tabu archive or the
curated map to map-conditioned compilation.

Curators keep three revisable ontologies: mechanism families, claimed outcomes
and causal world regimes. A new family is admitted only when the recorded
equivalence test says the primary causal operator changed. Diagnosis of those
ontologies informs which world to commission next, including family and outcome
combinations no candidate has yet; the choice stays with the caller. Promising mechanisms are transferred onto a
target model, with every role mapped and every disanalogy stated.

A second judge can check each curator decision: with the Jev estimator
configured it answers the same comparison without seeing the curator's reasons,
and disagreements appear in the diagnosis. A candidate between families can carry
a graded membership, shares with a remainder, beside its category. Target-blind
worlds can be exported as a content-addressed library and imported into another
search, which then starts at the solver.

Everything lives in the narrative graph as Understanding Nodes. Every task text
is stored, so each output cites what its role actually saw. Graded fits and
weighted selections follow the Meaning Model's Cut rule. Each ontology can be
exported as Meaning Model concepts and specialization relations. Worlds are
textual thought experiments and transfers are ideas, not evidence. See the
[alien add-on guide](profiles/ALIEN_ADDON.md). It exposes nine tools:

- `life_alien_search_start`
- `life_alien_task`
- `life_alien_record`
- `life_alien_ontology_revise`
- `life_alien_decision_check`, the second judge
- `life_alien_search_diagnose`
- `life_alien_atlas`
- `life_alien_worlds_export`
- `life_alien_worlds_import`

It also adds the `life-sim://addon/alien` guide, the bundled paper as
`life-sim://theory/ontology-of-the-alien`, and the `life_alien_start` prompt.

### Registry clients using npx

The official MCP Registry name is `io.github.emergent-wisdom/meaning-model`.
Its `npx` configuration requires `LIFE_SIM_ENGINE_BIN`: an absolute path to
the engine installed or built above. This avoids assuming that the package
instance in an `npx` cache is the same installation you prepared. Registration
does not download or build the engine for you.

From your installation directory, print the engine path:

```sh
node -p 'require("node:path").resolve("node_modules/@emergent-wisdom/meaning-model-mcp/rust-engine/target/release", process.platform === "win32" ? "life-sim-engine.exe" : "life-sim-engine")'
```

Use that path when a Registry client asks for `LIFE_SIM_ENGINE_BIN`, or set it
in a manual configuration:

```json
{
  "mcpServers": {
    "meaning-model": {
      "command": "npx",
      "args": ["--yes", "@emergent-wisdom/meaning-model-mcp@0.4.0"],
      "env": {
        "LIFE_SIM_ENGINE_BIN": "/absolute/path/to/life-sim-engine"
      }
    }
  }
}
```

The override is not required when directly starting the same installed
launcher whose engine you installed, as in the first configuration. Install or
build the matching engine when upgrading the package. On Windows its filename
ends in `.exe`.

The [complete server guide](mcp-server/README.md) describes modeling, the
paper-reading gate, tools, quotas, persistence limits, and the boundary between
implemented mechanisms and research proposals. This remains experimental
software; a released package does not establish the papers' learning claims.

## Prepare platform engines

The source repository includes `.github/workflows/engine-release.yml`. It builds
from an existing `v<package-version>` tag using a pinned Rust toolchain and
`Cargo.lock`. GitHub Actions run native builds on macOS arm64, macOS x64, Linux
x64 and Windows x64. Each job checks packaging and offline installation behavior,
starts the real Rust engine, then checks an MCP connection and engine status.
Only passing jobs upload the version-named executable and its `.sha256` file.

Once the reviewed source, workflow and matching tag are pushed, select **Build
engine release** in the repository's Actions tab. Run it with `tag: v0.4.0` and
leave `create_draft` false for a build and smoke run that only uploads workflow
artifacts. Set it true to create a draft release after all four platforms pass.
Pushing a new `v*` tag also runs the workflow and prepares a draft release.
Existing releases are never overwritten by the workflow. Only its final draft
job receives `contents: write`; build jobs have read access and action revisions
are pinned to full commit IDs.

Review the four platform jobs, all eight release assets and checksums. Publish
the reviewed GitHub draft before publishing the matching npm package. Drafts
are unavailable to the installer. Then install the exact candidate tarball and
run its `--install-engine` command on each supported platform to check public
download and execution. A local macOS check cannot establish Linux or Windows
compatibility; the four jobs and public-download checks are release gates.

The **Verify public engine release** workflow runs those real public
downloads and Rust/MCP checks on all four platforms. It runs when a release is
published or can be dispatched with the exact release tag, and never publishes
or modifies release assets.

The release assets are raw executables named
`life-sim-engine-v<version>-<Rust target>` (`.exe` on Windows), plus an adjacent
`.sha256` file. They contain no archive paths or extraction step. The package
and Rust engine versions, Git tag, and MCP metadata must agree. Review OS code
signing separately if you need it; this workflow does not sign or notarize.

## Prepare and publish the npm release

After the repository checks pass, create the complete tarball from the repository
root:

```sh
npm --prefix mcp-server run pack:release
```

Use the exact `tarball` path reported by that command. Direct packing or
publication of the `mcp-server` source directory is blocked because it omits
the Rust engine and required reading resources. Install that tarball and test
the explicit engine installation/build and MCP connection before approving it
for release.

Record the reviewed tarball's checksum and inspect the publication preview:

```sh
release_tarball="/absolute/path/to/emergent-wisdom-meaning-model-mcp-0.4.0.tgz"
shasum -a 256 "$release_tarball"
npm publish "$release_tarball" --dry-run --access public --ignore-scripts --registry=https://registry.npmjs.org/
```

Publication remains a separate release-owner decision. After approval of that
exact tarball, authenticate with an npm account that can publish to
`@emergent-wisdom` (`npm login` if needed), verify its identity, then publish:

```sh
npm whoami --registry=https://registry.npmjs.org/
npm publish "$release_tarball" --access public --ignore-scripts --registry=https://registry.npmjs.org/
npm view @emergent-wisdom/meaning-model-mcp@0.4.0 version dist.integrity --registry=https://registry.npmjs.org/
```

A dry run does not establish registry authentication or scope access. Any change
to the package requires a new tarball and review. See the
[npm publication documentation](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
for tarball publication and registry behavior.

Publish the official MCP Registry metadata only after the referenced npm
version is available. The root `server.json` name must match the package's
`mcpName`; both version fields must match the reviewed release. With release
approval, run the following from the repository root:

```sh
mcp-publisher login github
mcp-publisher publish server.json
```

Verify the entry through the
[official Registry API](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.emergent-wisdom/meaning-model).
Publisher credentials are local authentication material, never release files.

## Licensing

Code is MIT licensed; authored papers and documentation are CC BY 4.0.
See [LICENSE](LICENSE), [LICENSE-CONTENT](LICENSE-CONTENT), and [NOTICE](NOTICE)
for scope, attribution, and third-party material.
