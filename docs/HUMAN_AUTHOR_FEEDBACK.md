# Human authorship with LLM feedback

The human writes and directs the work. The LLM reads, models and gives feedback
within the requested scope. This workflow uses the same progressive resolution,
macro-to-micro exploration and Understanding Graph as the other workflows.
It does not require a fictional author persona or a new world before feedback
on a passage is possible.

Begin with `life_modeling_context`, purpose `human_author_feedback`. Enable
`MEANING_MODEL_ADDONS=storytelling` for `life_story_feedback`. The guide is
available without the add-on so the entry and its requirements remain visible.

## Read and respond

`life_story_feedback` accepts either an exact graph/root with its access scopes,
or supplied text. Give the author's question, purpose where known, and relevant
context. The tool prepares a read-only task bound to that material and request;
the calling LLM must still read and give the feedback. It does not produce an
automatic verdict or change the manuscript.

Read the whole and the longer developments before diagnosing a local effect.
If only an excerpt is supplied, say which larger context is unavailable. Follow
a consequential question into its underlying processes or assumptions: a
character's voice, a changing relationship, what the reader has learned, or an
institution behind an event. Use the existing grammar where a model is
available. Discover useful categories instead of imposing a genre or plot
formula. Keep interpretations provisional and respect intentional ambiguity.

Distinguish an observed feature of the text, an interpretation, a conflict with
a declared commitment and an optional artistic alternative. Link feedback to
specific evidence and explain what a proposed change would affect. Do not
rewrite, adopt a creative decision or expand the project unless the human asks.
The same rule applies to illustrative rewrites. The human can explicitly
delegate any of these tasks without changing the underlying model.

## Continue the construction

When the human chooses a revision, connect that decision to the affected
processes and passages. Preserve existing commitments or revise them explicitly,
then inspect dependent descriptions and scenes. A response may reasonably leave
the model unchanged; record why rather than manufacturing numerical changes.

When a project graph and permission to record are available, keep the review
under the actual reviewer through `life_review_record` and the human's response
as attributed Understanding Nodes. Questions, hypotheses, surprises, tensions
and tests belong there too. Suggestions stay separate from accepted decisions,
and fictional text is not evidence of its author's biography. Supplied text
alone does not authorize creating persistent personal memory or a project.
