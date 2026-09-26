# Bundled local viewer

This directory contains the frontend snapshot used by the MCP's local, read-only
browser viewer. It contains no model data, call logs, databases or book exports.

The frontend and numeric-path parser originate in
[meaning-model-viewer](https://github.com/emergent-wisdom/meaning-model-viewer),
based on commit `85f2235` with the responsive layout, panel sizing and concurrent
passage-caption fixes reviewed alongside this integration. Their MIT notice is
preserved in [LICENSE](LICENSE). Three.js revision 186 is bundled under its
[upstream MIT license](public/vendor/three/LICENSE).

The bundled adaptations are:

- `src/viewer-data.mjs`, in the parent MCP source directory, accepts complete
  definitions supplied by the service instead of opening a run directory.
- `public/start.js` opens the calendar scene for supported story snapshots;
  `public/inspector.js` shows the stored model and graph records otherwise.
  Noncalendar clocks and initial values keep their declared meanings.
- The bundled scene hides construction playback when no call timestamps were
  supplied and omits QR-code requests. The local MCP server serves immutable
  snapshots; opening the viewer again obtains a new snapshot.
- Normal reading retains the complete document in reading order when the world
  timeline moves. World dates do not establish what a reader may read.

The standalone viewer remains a separate project. When updating this snapshot,
preserve these adaptations and the upstream license files, and verify both a
book scene and a general model inspector.
