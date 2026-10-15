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
- `public/start.js` holds one page with seven representations of the same
  snapshot: Processes, Tree and Terrain (`public/view.js`), Chart
  (`public/chart-view.js`), Graph (`public/graph-view.js`), Structure
  (`public/inspector.js`) and Space (`public/space-view.js`). Each is built the
  first time it is shown and keeps the shared selection and time; noncalendar
  clocks and initial values keep their declared meanings.
- Lens readings are grouped into acts by `public/lens-readings.js`, so a deeper
  reading is drawn inside the answer it divides; the Graph's overview and its
  layout come from `public/model-graph.js`, and Space reads only declared
  coordinates through `public/space-model.js` (see below).
- The bundled scene hides construction playback when no call timestamps were
  supplied and omits QR-code requests. The local MCP server defaults to exact
  immutable snapshots and offers explicit live following of saved graph revisions.
- Normal reading retains the complete document in reading order when the world
  timeline moves. World dates do not establish what a reader may read.
- `public/search.js` adds one search field for every representation. It indexes
  the records the views can select (the model's records and the graph's notes
  and passages, in full, with everything a note stores) and the rows the time
  view draws, under the names the views show. In a time view a result opens at
  its place: a row at its curve (`temporalController.locate`), a note or passage
  at its moments; elsewhere through the shared selection. It replaces the Graph
  view's own find box.

The standalone viewer remains a separate project. When updating this snapshot,
preserve these adaptations and the upstream license files, and verify a book
scene, a general model inspector and each representation; `test/viewer-renderers.test.mjs`
runs the Space and Graph renderers on the real scene graph.

## What the Chart draws

The Chart puts a whole model on one time axis, read row by row; `public/chart-model.js` derives everything it draws
from declared records, so it is tested without a browser.

- **The axis** is even unless the records crowd toward its end (half of them in the last thirtieth of the span); then
  it is a log scale of time before the end, and the footer says so. Opening a part, or dragging across the chart,
  widens that stretch to most of the axis and draws it evenly.
- **Across the top** are the parts of one Event, exactly as the model contains them, each across its own time; parts
  that overlap share lanes, and nothing is picked out or renamed. Which Event is the view's `focus` setting, chosen
  under **Parts of** or by the model's recorded view (`life_model_viewer_view`); without one the top is empty. A choice
  under **Parts of** is written to the address and, on the model's view, marks it adjusted, so reopening the address
  keeps it.
  Opening a part lays out its own parts beneath it and widens it; opening any Event widens the part that contains it.
- **Events** sit in rows by the levels of one importance scale (the one that ranks the most Events, or the one picked
  under **Ranked for**), with the Events it does not rank in their own row; without a scale they share one row, in up
  to three lanes. Events inside a person's inner process have rows of their own; readings and other non-world
  contexts are not drawn. A filled mark has weighed causes; opening an Event draws its declared causal links, thicker
  for the causes that made more difference, and widens the part across the top that contains it.
- **Rows** follow the process decomposition, each process under the one it refines, with its values as the time
  views project them (`typedScalarTrajectories`): one row per series, named by its holder and, where one holder has
  several, by the mode, source or scope that tells them apart. A line runs only between the first and last samples,
  `~` marks a reading between samples, and the line style follows the value's tag. Folding a process hides every row
  of its parts. Parts declared as an `observational_partition` of a process are stacked as recorded, never rescaled
  to fill the whole, only when each part has exactly one series, all held by one holder in one unit; otherwise no
  total is implied and each part keeps its own row, named by whose it is. Processes outside the
  decomposition sit under the Event that holds them (a life, a development) when there is more than one such Event.
  Cut series (`cutTrajectories`) are stacked readings, drawn as the reading column reads them (`readingAt`, at one
  resolution for the current zoom): each reading across the interval it averages, with the remainder shown. Where a
  longer reading has finer ones open, the time they leave uncovered shows, dimmer, the level it must average, and
  nothing where no level can hold; a moment's reading is a narrow bar. Each series is read through
  `prepareReadings`, which works out the nesting once per zoom and reads exactly as `readingAt` does.
- **Events** in the controls shows the parts and Events above the time axis. It is off at first, so the rows take the
  whole height; the axis, the reading at the pointer and an opened Event's time stay. Choosing a whole under **Parts
  of** turns it on. When on, the parts and Events scroll away as the rows scroll and the axis stays at the top;
  **Pin** keeps them fixed above the rows, for a tall screen. **Whole span** returns from an opened part.
- **The panel** says how to read the chart (what its marks and lines mean, with the model's counts). The tour is the
  model's own: the highlights of its recorded view, in its order and with its reason for each; without a recorded view
  there is no tour. It shows an opened Event (its causes ranked by the difference each made alone, its Cuts,
  realized concepts, links and the processes it moves), a process row (its values and its place in the tree) or a
  group of Events too close to draw apart.
- **Shared with the other views**: opening an Event or a process shares the selection; a selection cleared in another
  view, or one the Chart cannot show (a Cut, a relation, a note), returns the panel to the guide. The moment the rows
  are read at is the session's time (`time.now`, in the time views' units): a moment set in a time view is where the
  Chart reads its rows, and a moment pinned in the Chart is where the time views open, as story time (a time view in
  construction mode turns to story mode to take it).

## Recorded process values

Processes and Tree show Cut readings as levels: a Cut on an Event with an
interval is the average over that interval, so it is drawn across the whole
interval rather than as a point joined to the next reading by a line. Readings
opened inside a longer reading stay in its series: zoomed out, the longer
reading stands for them; zoomed in, they show. Time that no reading covers
stays empty, and a remainder row appears only when some reading leaves a share
open. Two readings of exactly the same interval conflict and stay in the
independent Cut view.

Processes and Tree can also show dated scalar claims and approved
process-estimation records. Each compatible series keeps
its process, unit, holder, evidence and source. Separate estimation requests stay
separate. The line between samples is a visual guide, marked `~` when interpolated;
it stops at the last sample, and older authored series are not held after it. Review approval does not turn an estimate into an
accepted world value. **Numbers** retains single samples and conflicting records
that cannot form a curve. Untimed initial values remain untimed.

When only Event spans are available, a note explains that bars show intervals and
asks the agent to check recorded values and their display representation. Hiding
curves or viewing constant values does not trigger that note.

## Following a story as it grows

While authoring, open `life_model_viewer_open` with `graphHash` and `mode: "live"`.
The same local link checks for saved descendants about every two seconds. Each
adopted graph brings its exact bound model and rendered prose; a model revision
not yet bound to the graph does not appear. `mode: "snapshot"` (the default)
always keeps the selected exact revision. Model-only views, including automatic
author/reader life choices, remain snapshots. Each explicitly grouped graph can
independently request live mode.

The page says **Live · saved revisions** and can pause updates. A fork anywhere
after the revision explicitly opened pauses following, even if the page already
passed that ancestor. Open the intended branch explicitly to follow it. Every
replacement passes the full graph/model scope checks with the original grant;
an inaccessible or incomplete revision leaves the last authorized view intact.
The model chooser's membership is fixed when opened; reopen to include newly
declared author/reader lives. Following never publishes a model.

This implementation refreshes the page when a complete revision is ready; it
does not stream tokens or rebuild the existing renderers in place. It preserves
the selected view/record, time, camera and reader open/full state through
tab-local storage. Reading resumes at the same passage/paragraph and visual
offset where possible, so inserted earlier prose does not reset the reader. An
edited or removed paragraph falls back within its passage, then to the prior
scroll position. A removed spatial frame cannot reuse another frame's camera.
Refresh waits for scrolling, typing, selection, dragging and playback to pause.
When browser storage is unavailable it leaves the current page and asks for a
manual refresh. A brief page repaint remains possible. Static/standalone exports
do not enter this protocol: only an authorized MCP live snapshot carries its
explicit live marker.

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
