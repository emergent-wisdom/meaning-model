# Meaning Model MCP server

`@emergent-wisdom/meaning-model-mcp` exposes the Meaning Model's Rust engine
through MCP over stdio. The package includes JavaScript, Rust source and its
lockfile, modeling profiles, versioned paper resources, and checked presets.
It contains no prebuilt engine or build cache.

See the [changelog](CHANGELOG.md) for release changes and upgrade notes.

## Install

Install the package and matching engine together. Prebuilt installation needs
the matching published GitHub release assets; a candidate without those assets
can use the explicit source build below.

In a directory where you want to keep the installation, run:

```sh
npm install @emergent-wisdom/meaning-model-mcp@0.2.0
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
      "args": ["--yes", "@emergent-wisdom/meaning-model-mcp@0.2.0"],
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
engine release** in the repository's Actions tab. Run it with `tag: v0.2.0` and
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
release_tarball="/absolute/path/to/emergent-wisdom-meaning-model-mcp-0.2.0.tgz"
shasum -a 256 "$release_tarball"
npm publish "$release_tarball" --dry-run --access public --ignore-scripts --registry=https://registry.npmjs.org/
```

Publication remains a separate release-owner decision. After approval of that
exact tarball, authenticate with an npm account that can publish to
`@emergent-wisdom` (`npm login` if needed), verify its identity, then publish:

```sh
npm whoami --registry=https://registry.npmjs.org/
npm publish "$release_tarball" --access public --ignore-scripts --registry=https://registry.npmjs.org/
npm view @emergent-wisdom/meaning-model-mcp@0.2.0 version dist.integrity --registry=https://registry.npmjs.org/
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
