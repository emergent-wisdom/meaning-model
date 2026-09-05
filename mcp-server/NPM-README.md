# Meaning Model MCP server

`@emergent-wisdom/meaning-model-mcp` exposes the Meaning Model's Rust engine
through MCP over stdio. The package includes JavaScript, Rust source and its
lockfile, modeling profiles, versioned paper resources, and checked presets.
It contains no prebuilt engine or build cache.

## Install and build

Install the reviewed release `.tgz` from its local path. This works before
publication; installation by registry name requires a published version:

```sh
npm install /absolute/path/to/emergent-wisdom-meaning-model-mcp-0.1.0.tgz
npx meaning-model-mcp --build-engine
```

Node.js 22.18 or later, Cargo, a C compiler, and native build tools are required.
The explicit build compiles the included Rust sources for this machine and may
fetch dependencies pinned by `Cargo.lock`. There is no installation script or
automatic download of a prebuilt binary. Rebuild after installing an upgrade.
Alternatively, set `LIFE_SIM_ENGINE_BIN` to a compatible engine already built
for this machine. Rust dependencies include bundled SQLite.

## Connect

After the build, point an MCP client at the installed launcher:

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

The [complete server guide](mcp-server/README.md) describes modeling, the
paper-reading gate, tools, quotas, persistence limits, and the boundary between
implemented mechanisms and research proposals. This remains experimental
software; a released package does not establish the papers' learning claims.

## Prepare and publish a release

After the repository checks pass, create the complete tarball from the repository
root:

```sh
npm --prefix mcp-server run pack:release
```

Use the exact `tarball` path reported by that command. Direct packing or
publication of the `mcp-server` source directory is blocked because it omits
the Rust engine and required reading resources. Install that tarball and test
the explicit engine build and MCP connection before approving it for release.

Record the reviewed tarball's checksum and inspect the publication preview:

```sh
release_tarball="/absolute/path/to/emergent-wisdom-meaning-model-mcp-0.1.0.tgz"
shasum -a 256 "$release_tarball"
npm publish "$release_tarball" --dry-run --access public --ignore-scripts --registry=https://registry.npmjs.org/
```

Publication remains a separate release-owner decision. After approval of that
exact tarball, authenticate with an npm account that can publish to
`@emergent-wisdom` (`npm login` if needed), verify its identity, then publish:

```sh
npm whoami --registry=https://registry.npmjs.org/
npm publish "$release_tarball" --access public --ignore-scripts --registry=https://registry.npmjs.org/
npm view @emergent-wisdom/meaning-model-mcp@0.1.0 version dist.integrity --registry=https://registry.npmjs.org/
```

A dry run does not establish registry authentication or scope access. Any change
to the package requires a new tarball and review. See the
[npm publication documentation](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
for tarball publication and registry behavior.

## Licensing

Code is MIT licensed; authored papers and documentation are CC BY 4.0.
See [LICENSE](LICENSE), [LICENSE-CONTENT](LICENSE-CONTENT), and [NOTICE](NOTICE)
for scope, attribution, and third-party material.
