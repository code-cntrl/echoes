// Gentle tone checker shared by the browser (live hints) and the server (enforcement).
// level "hint": a suggestion. level "hurtful": blocked for anonymous feedback and
// feedback to kids; otherwise the sender must confirm before sending.

const RULES = [
  { level: 'hurtful', re: /\b(stupid|idiot|dumb|moron|loser|ugly|fat|shut up|hate you|worthless|pathetic)\b/i,
    tip: 'This can really hurt. Try describing what happened and how you felt instead.' },
  { level: 'hint', re: /\b(always|never|every single time)\b/i,
    tip: '"Always" and "never" can feel like an attack. Try describing one specific time.' },
  { level: 'hint', re: /\byou(?:'re| are) (?:so |such an? |being )?(lazy|selfish|mean|rude|annoying|useless|careless|immature|ridiculous|crazy)\b/i,
    tip: 'Describe the behavior, not the person. What did they actually do?' },
  { level: 'hint', re: /\b(you should(?:'ve| have)?|you need to|you have to)\b/i,
    tip: 'Demands can make people defensive. Try a request like "Could you…?"' },
  { level: 'hint', re: /\b(whatever|obviously)\b/i,
    tip: 'This can sound dismissive. Is there a softer way to say it?' },
  { level: 'hint', re: /(!{2,}|\b[A-Z]{5,}\b)/,
    tip: 'Lots of capitals or exclamation marks can read as shouting.' },
];

export function checkTone(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = [];
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) found.push({ level: rule.level, match: m[0], tip: rule.tip });
  }
  return found;
}

export function checkFields(fields) {
  return Object.values(fields || {}).flatMap((v) => checkTone(v));
}

export function isHurtful(fields) {
  return checkFields(fields).some((f) => f.level === 'hurtful');
}
