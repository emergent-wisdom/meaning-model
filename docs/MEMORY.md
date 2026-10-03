# Agent and user memory

Memory uses the same model, Understanding Graph and recursive construction
method as the other workflows. It is available in the core server. Begin with
`life_modeling_context`, purpose `agent_memory` or `user_memory`, and follow its
reading order. These purposes do not replace `sessionMode`, which still says
whether this is first use or continuation.

## Model development, not just recall

Agent memory concerns the agent's work: goals, attempts, decisions, expectations,
learning and unfinished questions. User memory concerns the user's reported
history, preferences, commitments and changing circumstances. Shared work can
connect both. Keep the user as subject distinct from the agent holding an
interpretation; quoting a user does not make the quoted account an observation.

Begin with the enclosing project, relationship or life context and a useful
longer horizon. Open the episodes and subprocesses that help explain the current
question. For example, “prefers brief answers” may be one report; a useful model
might distinguish quick decisions from learning a new subject, then track how
that preference varies with purpose and experience. That distinction is an
attributed hypothesis until the evidence supports it. Do not invent a life
history or conclude that every short request reveals a permanent trait.

Use native processes, Events, concepts and relations for the changing account.
Use Understanding Nodes for reports, interpretations, questions, hypotheses,
predictions, surprises, tests and reasons. Link them to what they concern. A
`validates` or `invalidates` edge records its holder's assessment; it is not an
engine verification. New categories can grow from recurring distinctions, and
explicit structures can support further abstraction. No fixed personality
inventory, numeric score or prescribed depth is required.

## Start, record and continue

1. Check `life_engine_status`. Set `LIFE_SIM_STATE_FILE` before starting the MCP
   if the work must survive a restart. Otherwise it is session-only memory.
2. Declare the context, subjects and scope with `life_memory_start`. A new model
   also needs `time.unit` and `time.origin`, defining the modeled timeline and
   time zero separately from the recording order. Reuse a
   known model when appropriate. A new context provides only a qualitative
   starting anchor; it does not model the whole process or life for you.
3. Record useful information with `life_memory_record`, linked to the relevant
   model records or Understanding Nodes. Within the user's chosen scope, the
   agent may capture useful information without approval for each entry. This
   does not authorize collecting other conversations, sharing across projects
   or silently expanding the scope.
4. Develop the underlying account with the ordinary model revision tools;
   preserve coarse commitments or revise them explicitly. Rebind the graph to
   the new model, then record the evidence and reasoning against those records.
   A note about learning is not a substitute for modeling the process when its
   changes matter to the work.
5. Retrieve with `life_memory_query`. Keep the source, holder, relevant time,
   uncertainty and disagreement visible. Superseded entries remain in history;
   a later statement is not automatically a correction. A real change of
   preference and a correction of an earlier account are different operations.
   Only the same holder's account about the same subject is replaced by
   `supersedes`; another holder can disagree using `contradicts` or `refines`.
6. On continuation, use `life_saved_work_list` within the known scopes. Finish
   paging and select the intended branch. Recover an unfamiliar history through
   its replay and outline. When the exact previously read head and context are
   retained, read subsequent changes and the records relevant now. No tool
   silently chooses between branches.

The authoring step is the recording order, not the time the remembered event
occurred. Preserve those two times separately. Use stable IDs for retries;
changed information needs a new entry and an explicit relation to the previous
account.

When a new report, correction or consequential result arrives, re-read the
affected earlier accounts, interpretations, tensions and linked evidence before
deciding what to retain, revise or do next; re-entry is not only for startup,
and no new note is needed if nothing material changes. Dependency invalidation
is not automatic: a corrected source does not refresh the patterns, hypotheses
or plans built on it, so inspect those dependents and revise them, mark them
unresolved, or record why they still stand.

Preserve known coarse dates and ordering even when exact dates are unknown.
Where historical queries matter, establish a suitable time origin and units
and represent the evidenced phases or states explicitly. A current initial
value plus dates in prose is not a queryable trajectory; report that limitation
when the temporal structure is incomplete. Keep the agent's decisions about
storing or preserving a report in its own attributed record, not in the user's
report text.

Connect subjects to their native Events and processes with Event participants
or `event_referent_bindings`. A report's holder or an Understanding `about` link
does not establish that native relationship. Use `contains` for part-to-whole
structure. For person-state queries, pass `people: [{ id: referentId }]` and `at` to
`life_model_questions`; automatic person discovery need not
recognize a custom memory structure. Inspect whether the intended processes
and accounts are actually returned before relying on that projection.

An Event interval represents its extent, not uncertainty about when it happened.
For “joined sometime in 2021”, a separate 2021 context period may contain an
undated joining Event. Do not give the joining itself a year-long duration.
That records coarse containment; it does not supply an exact occurrence time or
make the date uncertainty executable. Inspect the linked records and source
when the query cannot express that uncertainty.

Keep the scope of each time query explicit. `life_memory_query` retrieves
attributed entries, not a reconstructed process state. The person-state summary
keeps declared `initialValue` separate from accounts with `value_time` and
`evidence_cutoff`; its `at` filters evidence availability, not retrospective
truth. A report learned today about September was not thereby known in
September. Initial claims cannot carry evidence after model time zero. Later
runtime observations use the world observation tools, with their returned
projection time checked separately; the model's person-state summary does not
read runtime history. A runtime observation currently dates the value and its
evidence at the observation step, so it cannot by itself represent a later
report about an earlier value. Keep that report and its historical target
explicitly linked instead of backdating the observation or silently changing
the time origin.

Batch durable discoveries, consequential decisions and unresolved questions
into coherent records. Ordinary conversational replies do not each require a
new reading plan or independent reader experiment. Use controlled read-back
for a substantial communication deliverable or a specific unresolved fidelity
question. This changes the cadence of bookkeeping, not the recursive inquiry:
use new structure to investigate further processes, explanations and concepts
when they can improve the work.

## Optional conversation sources

Transcript capture is off by default. Enable or disable it for the chosen
memory context with `life_memory_transcript_configure`. The caller or chat
integration supplies visible user messages and assistant responses through
`life_memory_transcript_capture`; the server cannot independently observe a
chat. Supply stable conversation and message IDs, sequence and speaker, and
timestamps only when known. Each message retains its exact text as a separate
source node. Repeating the same capture is safe; changing the text under an
existing identity is refused.

Keep derived reports, interpretations and process models separate from the
source messages. Link a memory to its message node with `learned_from` and to
the model records it concerns. The text is evidence of what was said, not
automatic acceptance of the claims it contains. Keep the original statement
when a later message corrects it, and revise the dependent account explicitly.

Use `life_memory_transcript_query` for relevant messages, with pagination;
storing a conversation does not require loading it all on each turn. Ordinary
memory queries return derived entries, not the transcript. Capture preserves
the context's scope and excludes messages from story rendering and training
by default. Do not collect hidden reasoning, system/developer instructions,
unrelated conversations or tool chatter. Switching capture off stops new
recording while leaving existing sources available; it is not an erasure
operation. Capturing a message does not require a fresh review or
interpretation after every reply.

## Boundaries

This is an instructed workflow for the calling agent, not a background observer
or an automatic training system. The server stores declared records and returns
them; it does not independently discover a person's history or certify its
interpretations. An external account of the agent's work is not a claim of
access to hidden neural processes or internal reasoning.

Scopes are visibility labels in a trusted local server, not authentication.
Matching any label grants visibility; adding labels can broaden access. Memory
contexts retain their declared scopes. An empty result is not proof that no
other memory exists. Exporting a construction can include personal history:
choose the intended scope and inspect the result before sharing it. Immutable
correction retains earlier records; supersession is not erasure.
