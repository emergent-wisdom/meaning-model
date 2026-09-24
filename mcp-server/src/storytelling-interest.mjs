// What makes a story interesting, as things to investigate in the model. Each element says why it makes a story
// interesting and how to investigate it by modeling. The catalog is a beginning, not a boundary: the aspects stage
// finds where every element lives in this story, investigates each, and adds elements of the agent's own that no
// list names. None is a checklist item satisfied by naming it. Sources: the Book of Conditions'
// person models and understanding notes, and the principles its human director gave.

export const storyInterest = Object.freeze([
  // People
  { id: 'flaws', group: 'people', element: 'Flaws', why: 'A flaw makes a person fallible in a way the reader recognizes, and makes their choices costly.',
    investigate: 'Model each principal\'s flaw as a process over their life: the event that taught it (often a strategy that once served a deep want), the situations in which it takes over, where the same trait is a strength and where it does harm, what it costs in the story\'s choices, whether they see it, and whether it changes. The Book: Babbage turns every threatened dependence into more control, brilliant for architecture and damaging for shared authority.' },
  { id: 'wants', group: 'people', element: 'Conflicting wants', why: 'People who want incompatible things, or one thing in incompatible ways, have to choose.',
    investigate: 'Model the deepest wants and the learned wants that serve them, where two conflict, and the proxy that displaces a deep aim; Cuts of motivational attention at the moments that matter.' },
  { id: 'choices', group: 'people', element: 'Choices', why: 'A choice with a cost, made by a person the reader understands, is where a story happens.',
    investigate: 'Model each consequential choice as a moment: what the person wants, feels and how they decide there, the continuations as a decision Cut whose weights come from that state, and a recorded draw; then what follows.' },
  { id: 'change', group: 'people', element: 'Change', why: 'Growth, regression, or a change that fails to hold is what a life does over a story.',
    investigate: 'Model the principal\'s states across periods and the shocks between them: which change consolidated into a new baseline, which recovered, which never happened.' },
  { id: 'relationships', group: 'people', element: 'Relationships', why: 'What people rely on each other for, and refuse to, shapes every scene they share.',
    investigate: 'Model each relationship as a process over time: its phases and shocks, what each relies on the other for and what they will not rely on them for, and how it changes.' },
  { id: 'self-image', group: 'people', element: 'Self-image', why: 'The gap between who a person thinks they are and what drives them is where irony and recognition live.',
    investigate: 'Model how the person sees themselves as a belief process of its own, beside what actually drives them, and the moments the gap shows or closes.' },
  { id: 'voice', group: 'people', element: 'Voices', why: 'A voice that could only be this person makes them present.',
    investigate: 'Derive each voice from the modeled life: work, class, era, body, what they attend to, how their speech changes under threat, joy or illness.' },
  { id: 'secondary', group: 'people', element: 'Secondary lives', why: 'People who have lives beyond their function make a world populated rather than staged.',
    investigate: 'Give secondary people lives with a deep want, a proxy and a shock of their own, and consequences beyond their assigned job.' },
  // Events and structure
  { id: 'shock', group: 'events', element: 'The central shock', why: 'A shock that changes what people want, in different directions, drives the whole story.',
    investigate: 'Model the shock with its anticipation and adaptation for each principal, and how each reads it differently; consider whether a success, a gift or a recognition would change more than another loss.' },
  { id: 'stakes', group: 'events', element: 'Stakes and costs', why: 'The reader cares when something real can be lost.',
    investigate: 'Model what is at risk for whom, in the quantities that matter (money, time, health, standing, love), and what each choice actually costs.' },
  { id: 'causality', group: 'events', element: 'Causality', why: 'Consequences that follow from causes make a story feel true rather than arranged.',
    investigate: 'Trace each consequential Event to its causes in the model, and follow each commitment into what it implies later; nothing happens without a modeled cause.' },
  { id: 'surprise', group: 'events', element: 'Surprise with inevitability', why: 'The best turns are surprising when they come and inevitable afterwards.',
    investigate: 'Find the model\'s jumps and closest-run decisions; model the causes that make an unexpected outcome inevitable in hindsight.' },
  { id: 'tension', group: 'events', element: 'Tension', why: 'Anticipation, what people expect and fear, holds the reader across a scene and a book.',
    investigate: 'Model what each person expects and fears (outlook and threat Cuts), the constraints that close in (deadlines, capacities, money running out), and when they bind.' },
  { id: 'secrets', group: 'events', element: 'Secrets and knowledge', why: 'Who knows what, and when the reader learns it, creates irony, suspense and revelation.',
    investigate: 'Model what each person knows and believes at each moment, what is hidden from whom and why, and when each thing is disclosed to them and to the reader.' },
  { id: 'mystery', group: 'events', element: 'Open questions', why: 'A question the reader wants answered pulls them forward.',
    investigate: 'Model the questions the story raises for the reader, when each is raised, and what in the world answers it and when.' },
  { id: 'reversals', group: 'events', element: 'Reversals', why: 'A turn of fortune or understanding reorganizes everything before it.',
    investigate: 'Model the moments where outcome or understanding turns, what each person believed just before, and what the turn changes in them.' },
  // World
  { id: 'era', group: 'world', element: 'The era and its long history', why: 'A story in a real or fully imagined time carries the weight of what came before it.',
    investigate: 'Model the long developments over decades or centuries (wars, institutions, technologies, beliefs, family lines) that explain why things are as they are, and let the lives sit inside them.' },
  { id: 'place', group: 'world', element: 'Place', why: 'Where things happen, and the physical state of the people and things there, grounds every scene.',
    investigate: 'Model places and their conditions (weather, traffic, work, crowds) as processes, the positions of people and Things at each moment, and how place constrains access and timing.' },
  { id: 'mechanisms', group: 'world', element: 'Mechanisms and technology', why: 'How the things in a story actually work gives its turns their precision.',
    investigate: 'Model the Things the causality runs through as they work: parts, capacities, limits, failure modes and quantities, and what they allow and forbid people to do.' },
  { id: 'institutions', group: 'world', element: 'Institutions and money', why: 'Rules, incentives and money push people in directions they do not choose.',
    investigate: 'Model the institutions, their rules and routines, the incentives they create, and the money: who owes, earns and pays what, and when it runs out.' },
  { id: 'residue', group: 'world', element: 'Objects that return', why: 'An object that returns with a changed use shows adaptation without explaining it.',
    investigate: 'Model the objects that recur, their states and uses across the story, and what each change of use shows.' },
  { id: 'senses', group: 'world', element: 'The senses', why: 'Sensory detail from the things taking part makes a scene physical.',
    investigate: 'Model the Things taking part in each Event and their changing physical states (sound, heat, light, weight, smell), so the senses come from the model.' },
  // Meaning
  { id: 'author', group: 'meaning', element: 'The author', why: 'A book comes out of a life, and what the author is figuring out gives it its urgency.',
    investigate: 'Model the author\'s life, why they write this story now, what they want to teach and what they are figuring out by writing it.' },
  { id: 'style', group: 'meaning', element: 'Style', why: 'A style that comes from a life gives the prose a character of its own.',
    investigate: 'Derive the writing style from the author\'s modeled life: what they attend to, what they omit, their rhythm and images, and why.' },
  { id: 'theme', group: 'meaning', element: 'Theme', why: 'A story is about something when its events test an idea rather than illustrate it.',
    investigate: 'Model the question the story tests, the concepts it turns on and how the events bear on them; climb up to what the story\'s events instantiate.' },
  { id: 'buttons', group: 'meaning', element: 'What it presses in the reader', why: 'A story matters to a reader when it touches a fear, longing, shame or hope of their own.',
    investigate: 'Model the reader, or name the buttons: what the story presses, how, and what the reader could learn about their own life.' },
  { id: 'moral', group: 'meaning', element: 'Moral weight', why: 'A dilemma where each side is partly right is harder and truer than a choice between good and bad.',
    investigate: 'Model the dilemmas: what each side values, why each is partly right, and what choosing costs each person.' },
  { id: 'joy', group: 'meaning', element: 'Joy and competence', why: 'Pleasure in work, discovery and one another makes loss mean something.',
    investigate: 'Model the moments of competence, discovery and shared pleasure as Events that change beliefs, not decorations.' },
  { id: 'humor', group: 'meaning', element: 'Humor', why: 'Incongruity and character-driven comedy relieve and sharpen a story, even a dark one.',
    investigate: 'Model where the people\'s habits, expectations and situations collide incongruously, and who finds what funny and why.' },
  { id: 'ending', group: 'meaning', element: 'The ending', why: 'An ending is earned when every principal pays for it and what survives it means something.',
    investigate: 'Model what each principal pays, what the world keeps, and what survives the story and why.' },
]);
export const storyInterestIds = Object.freeze(storyInterest.map((item) => item.id));

export const interestInstructions = `What makes a story interesting can be found and investigated in the model. The catalog is a beginning, not a boundary: it lists elements that often make a story interesting, and this story may turn on others no list names, which you find, name and investigate too. Its elements are people (flaws, conflicting wants, choices, change, relationships, self-image, voices, secondary lives), events (the central shock, stakes and costs, causality, surprise with inevitability, tension, secrets and knowledge, open questions, reversals), the world (the era and its long history, place, mechanisms and technology, institutions and money, objects that return, the senses) and meaning (the author, style, theme, what it presses in the reader, moral weight, joy and competence, humor, the ending). For each, find where it lives in this story and investigate it by modeling, each principal's flaw among them; an element that turns out absent is still investigated, so say what the model showed. Then ask what else makes this story interesting, invent the categories for it, and investigate those as well; the aspects stage records at least one of your own.`;
