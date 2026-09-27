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
- `public/start.js` holds one page with six representations of the same
  snapshot: Processes, Tree and Terrain (`public/view.js`), Graph
  (`public/graph-view.js`), Structure (`public/inspector.js`) and Space
  (`public/space-view.js`). Each is built the first time it is shown and keeps
  the shared selection and time; noncalendar clocks and initial values keep
  their declared meanings.
- Lens readings are grouped into acts by `public/lens-readings.js`, so a deeper
  reading is drawn inside the answer it divides; the Graph's overview and its
  layout come from `public/model-graph.js`, and Space reads only declared
  coordinates through `public/space-model.js` (see below).
- The bundled scene hides construction playback when no call timestamps were
  supplied and omits QR-code requests. The local MCP server serves immutable
  snapshots; opening the viewer again obtains a new snapshot.
- Normal reading retains the complete document in reading order when the world
  timeline moves. World dates do not establish what a reader may read.

The standalone viewer remains a separate project. When updating this snapshot,
preserve these adaptations and the upstream license files, and verify a book
scene, a general model inspector and each representation; `test/viewer-renderers.test.mjs`
runs the Space and Graph renderers on the real scene graph.

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
- **Whose position** comes from a coordinate/position
  `event_referent_binding` whose target is the process. Its `interval` bounds
  the declaration. The process's stated meaning distinguishes bodily presence
  from a home or work base; a base never implies uninterrupted occupancy.
- **Coarse life locations** use existing process scale metadata:
  `spatial_status: "coarse_life_location"`, `location_role` (`home_base`,
  `workplace`, `visit` or `presence`), `place_ref`, and a concise `label`.
  These declarations produce the lifetime overview and separate role lanes.
  Dashed links join successive records for the same subject and role in one
  frame; they do not supply a route, speed or position during an unrecorded gap.
- **Connections** follow native Event `process_ids`, subject/place bindings
  and narrative grounding edges. Include the position process in its Event
  and anchor relevant Understanding notes and passages to those records.
  Selecting a location shows direct period connections first, separately from
  broader place and person context. The viewer never infers these links from
  words in the prose.
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
  in those Events, and are not drawn. Explicit presence is distinguished from
  participation in an Event, which can include remote communication.

Space uses the shared bottom playback controls. Coarse returns to its lifetime
overview without changing representation; the frame menu opens scene layouts.
The main toolbar can be hidden while exploring, and Home recenters the view.
