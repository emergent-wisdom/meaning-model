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

## What the Space view draws

Space draws only coordinates a model declares, to scale, one reference frame and
unit at a time. It never places anything from a name, an Event's region or prose.

- **A position** is a process whose value is an `object_pose` or a `vector` with
  scale `semantic_role: "position"`, or scalar processes with
  `semantic_role: "position"` and a scale `axis`. Scalars of one thing share a
  `spatial_entity:<id>` support item (else an id ending in `.position.<axis>`)
  and one `reference_frame` and `unit`.
- **Axes** `x`, `y`, `z` lie east, north and up. A frame whose axes are
  `latitude` and `longitude` (optionally `altitude`) is drawn as a map, with
  longitude narrowed by the cosine of the frame's middle latitude.
- **Whose position** comes from an `event_referent_binding` whose target is the
  process. A binding `interval` means the position holds only then: several such
  processes bound to one referent are its successive stays, joined by a dashed
  line in time order that is their sequence, not a route.
- **Precision** is the process's `uncertainty`: a `standard_deviation` or an
  `interval` is drawn as a spread on the ground; `exact` and undeclared are said
  in the details. A town's representative point and a surveyed building differ
  only in what the model declares here.
- **Change** is drawn only where it is exact: one always-active `evolution` law
  whose derivative is a constant or a static process (from the model's start,
  time 0), or always-active `occurrence` laws whose trigger is the clock reaching
  a time (`threshold` on `time`, `on_enter`) and whose effects `set` constants.
  Any other law on a position is named in the details, not evaluated.
- **Places without coordinates** (an Event bound to a referent with binding type
  `located_in` or `spatial_setting`) are listed with their dates and the people
  in those Events, and are not drawn.
