# Meaning Model MCP server

`@emergent-wisdom/meaning-model-mcp` exposes the Meaning Model's Rust engine
through MCP over stdio. The package includes JavaScript, Rust source and its
lockfile, modeling profiles, versioned paper resources, and checked presets.
It contains no prebuilt engine or build cache.

## Install and build

Install a published version, or substitute the local release `.tgz` path while
preparing a release:

```sh
npm install @emergent-wisdom/meaning-model-mcp
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

## Licensing

Code is MIT licensed; authored papers and documentation are CC BY 4.0.
See [LICENSE](LICENSE), [LICENSE-CONTENT](LICENSE-CONTENT), and [NOTICE](NOTICE)
for scope, attribution, and third-party material.
