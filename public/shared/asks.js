// Asking family members for feedback on something you did. The rules live in core.js (checkAsk and
// the /api/asks routes); this holds what the rules and the screens share.

export const ASK_HELP = [
  { id: 'well', label: 'What went well' },
  { id: 'try', label: 'One thing to try' },
  { id: 'both', label: 'Both' },
];
export const ASK_MAX = 300;

// Anonymous answers only when at least this many people are asked, so nobody can tell who said what.
export const ANON_ASK_MIN = 3;


export const helpLabel = (id) => (ASK_HELP.find((h) => h.id === id) || ASK_HELP[2]).label;
