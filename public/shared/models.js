// Feedback models shared by the server (validation) and the browser (composer).
// To add a model, append an entry here; no other code changes are needed.
//
// audience: "all" (everyone), "adult" (made for grown-ups, with more steps) or "kid" (made for kids).
// Everyone can use every style; kids see the kid-friendly ones first.
// Field types: "text" (free text) or "choice" (pick one option; with multiple: true, pick any number,
// stored as a list). EXAMPLES (below) holds worked examples for each style's text fields, shown as
// grey ghost text while writing: ones for kids writing and ones for grown-ups.

const FEELINGS = [
  { value: 'happy', label: 'Happy', emoji: '😊' },
  { value: 'proud', label: 'Proud', emoji: '🌟' },
  { value: 'thankful', label: 'Thankful', emoji: '🙏' },
  { value: 'sad', label: 'Sad', emoji: '😢' },
  { value: 'mad', label: 'Mad', emoji: '😠' },
  { value: 'worried', label: 'Worried', emoji: '😟' },
  { value: 'left-out', label: 'Left out', emoji: '🥺' },
  { value: 'frustrated', label: 'Frustrated', emoji: '😤' },
];

export const MODELS = [
  {
    id: 'kids',
    name: 'Kind Words',
    emoji: '🧸',
    audience: 'kid',
    summary: 'A simple, kid-friendly way to share how you feel and what you wish for.',
    fields: [
      { key: 'feeling', label: 'How did you feel?', type: 'choice', multiple: true, options: FEELINGS, required: true,
        hint: 'Pick all that fit.' },
      { key: 'happened', label: 'What happened?', type: 'text', required: true },
      { key: 'wish', label: 'Next time, could you…', type: 'text', required: false },
      { key: 'like', label: 'Something I like about you 💛', type: 'text', required: false },
    ],
    tips: ['Use "I feel…" words', 'Talk about what happened, not about the person', 'Say one nice thing too'],
  },
  {
    id: 'glow-grow',
    name: 'Glow & Grow',
    emoji: '🌱',
    audience: 'all',
    summary: 'One thing that shines (glow) and one thing to work on (grow). Great for kids and grown-ups.',
    fields: [
      { key: 'glow', label: '✨ Glow: something they did well', type: 'text', required: true },
      { key: 'grow', label: '🌱 Grow: something to try next time', type: 'text', required: false },
    ],
    tips: ['Be specific about the glow', 'Keep the grow to one small, doable thing'],
  },
  {
    id: 'thanks',
    name: 'Thank-You Note',
    emoji: '💌',
    audience: 'all',
    summary: 'Pure appreciation. Notice something good and say thank you.',
    fields: [
      { key: 'what', label: 'What did they do?', type: 'text', required: true },
      { key: 'impact', label: 'How did it help you?', type: 'text', required: false },
    ],
    tips: ['Small things count', 'Say how it made a difference'],
  },
  {
    id: 'dearman',
    name: 'DEAR MAN',
    emoji: '🧭',
    audience: 'adult',
    summary: 'From Dialectical Behavior Therapy (DBT): ask for what you need clearly while protecting the relationship.',
    fields: [
      { key: 'describe', label: 'D: Describe', type: 'text', required: true,
        hint: 'Just the facts, as a camera would record them. No judgments.' },
      { key: 'express', label: 'E: Express', type: 'text', required: true,
        hint: 'Your feelings and opinions, using "I" statements.' },
      { key: 'assert', label: 'A: Assert', type: 'text', required: true,
        hint: 'Ask clearly for what you want, or say no clearly.' },
      { key: 'reinforce', label: 'R: Reinforce', type: 'text', required: false,
        hint: 'Explain the upside for them (and you) if this happens.' },
      { key: 'negotiate', label: 'N: Negotiate', type: 'text', required: false,
        hint: 'What are you willing to give to get? Offer alternatives.' },
    ],
    tips: [
      'M: stay Mindful, keep to this one topic',
      'A: Appear confident, with a calm, steady tone',
      'N: be willing to Negotiate',
    ],
  },
  {
    id: 'sbi',
    name: 'Situation-Behavior-Impact',
    emoji: '🎯',
    audience: 'adult',
    summary: 'A clear, low-blame structure: where and when, what they did, and the effect it had.',
    fields: [
      { key: 'situation', label: 'Situation', type: 'text', required: true,
        hint: 'When and where did it happen?' },
      { key: 'behavior', label: 'Behavior', type: 'text', required: true,
        hint: 'What did they say or do? Observable actions only.' },
      { key: 'impact', label: 'Impact', type: 'text', required: true,
        hint: 'How did it affect you or others?' },
      { key: 'request', label: 'Request (optional)', type: 'text', required: false },
    ],
    tips: ['Describe behavior, not character', 'Positive SBI works great too'],
  },
  {
    id: 'nvc',
    name: 'Nonviolent Communication',
    emoji: '🕊️',
    audience: 'adult',
    summary: 'Marshall Rosenberg’s four steps: observation, feeling, need, request.',
    fields: [
      { key: 'observation', label: 'Observation', type: 'text', required: true,
        hint: 'What happened, without evaluation.' },
      { key: 'feeling', label: 'Feeling', type: 'choice', multiple: true, options: FEELINGS, required: true,
        hint: 'Pick the closest feelings; more than one is fine.' },
      { key: 'need', label: 'Need', type: 'text', required: true,
        hint: 'What need of yours is behind the feeling?' },
      { key: 'request', label: 'Request', type: 'text', required: true,
        hint: 'A specific, doable request, not a demand.' },
    ],
    tips: ['Requests can be declined; demands cannot', 'Name needs, not strategies'],
  },
];

// Worked examples, one set of text fields each, for kids ("kid") or grown-ups ("adult") writing.
const EXAMPLES = {
  kids: [
    { for: 'kid', fields: { happened: 'When you played with my Lego without asking…', wish: '…ask me first?', like: 'You build the coolest towers!' } },
    { for: 'kid', fields: { happened: 'When you said I couldn’t play with you and your friends…', wish: '…let me join for one game?', like: 'You’re really good at making up games.' } },
    { for: 'adult', fields: { happened: 'When you helped your sister tie her shoes this morning…', wish: '…keep helping her like that?', like: 'You’re a really kind big brother.' } },
    { for: 'adult', fields: { happened: 'When you slammed the door after our talk…', wish: '…tell me you need a minute instead?', like: 'I love how much you care about being fair.' } },
  ],
  'glow-grow': [
    { for: 'kid', fields: { glow: 'You read me a really funny bedtime story.', grow: 'Could you do the voices again tomorrow?' } },
    { for: 'kid', fields: { glow: 'You let me pick the music in the car.', grow: 'Maybe tell me earlier when we have to leave.' } },
    { for: 'adult', fields: { glow: 'You were really patient helping Grandma with her phone.', grow: 'Maybe let her try the steps herself next time.' } },
    { for: 'adult', fields: { glow: 'You made the whole birthday dinner feel relaxed.', grow: 'Next time, could we plan the shopping together?' } },
  ],
  thanks: [
    { for: 'kid', fields: { what: 'You helped me with my math homework.', impact: 'I got all the answers right the next day!' } },
    { for: 'kid', fields: { what: 'You made my lunch when I was running late.', impact: 'I made the bus and had a great day.' } },
    { for: 'adult', fields: { what: 'You took the kids to practice so I could rest.', impact: 'I finally had a quiet hour, and I felt so much better.' } },
    { for: 'adult', fields: { what: 'You fixed the wobbly shelf without me asking.', impact: 'It’s one less thing on my list this week.' } },
  ],
  dearman: [
    { for: 'kid', fields: {
      describe: 'Yesterday you came into my room without knocking.', express: 'I felt embarrassed because I was getting changed.',
      assert: 'Please knock and wait for me to say “come in”.', reinforce: 'Then I’ll be happy to let you in.', negotiate: 'If it’s really urgent, you can knock twice.',
    } },
    { for: 'kid', fields: {
      describe: 'At dinner you said I can’t have my phone, but my brother had his.', express: 'I felt it wasn’t fair.',
      assert: 'Could we have the same rule for both of us?', reinforce: 'Then I won’t argue about it every night.', negotiate: 'I’ll put my phone away at dinner if he does too.',
    } },
    { for: 'adult', fields: {
      describe: 'On Saturday you came home at 11pm and didn’t text.', express: 'I felt really worried and couldn’t sleep.',
      assert: 'I’d like a quick text if you’ll be later than 10.', reinforce: 'Then I can relax, and it’s easier for me to say yes to late nights.', negotiate: 'Happy to make it 10:30 on weekends.',
    } },
    { for: 'adult', fields: {
      describe: 'This week the laundry was left in the washer three times.', express: 'I feel tired when I have to wash it again.',
      assert: 'Please move it to the dryer when it finishes.', reinforce: 'Then our clothes stay fresh, and I won’t need to remind you.', negotiate: 'If you set a timer for it, I’ll do the folding.',
    } },
  ],
  sbi: [
    { for: 'kid', fields: {
      situation: 'On Saturday at the park…', behavior: '…you stayed on the bench looking at your phone…',
      impact: '…and I felt like you didn’t see my new trick.', request: 'Could you watch me for five minutes next time?',
    } },
    { for: 'kid', fields: {
      situation: 'When I was doing my homework yesterday…', behavior: '…you turned the TV up really loud…',
      impact: '…and I couldn’t think.', request: 'Could you keep it quieter until I finish?',
    } },
    { for: 'adult', fields: {
      situation: 'At dinner last night…', behavior: '…you were on your phone while I was telling my story…',
      impact: '…and I felt like it wasn’t interesting to you.', request: 'Could we keep phones off the table at dinner?',
    } },
    { for: 'adult', fields: {
      situation: 'This morning before school…', behavior: '…you had packed your bag the night before…',
      impact: '…and we left on time without any rushing. Thank you!', request: 'Could you keep doing that on school nights?',
    } },
  ],
  nvc: [
    { for: 'kid', fields: {
      observation: 'You borrowed my headphones and didn’t give them back.', need: 'I need my things to be there when I want them.',
      request: 'Would you ask me first, and put them back on my desk?',
    } },
    { for: 'kid', fields: {
      observation: 'You said “hurry up” five times this morning.', need: 'I need a bit more time to get ready.', request: 'Could you wake me up ten minutes earlier?',
    } },
    { for: 'adult', fields: {
      observation: 'The dishes have been in the sink since Tuesday.', need: 'I need to feel we share the housework.', request: 'Would you wash them before tomorrow evening?',
    } },
    { for: 'adult', fields: {
      observation: 'You checked your phone three times while I was talking about my day.', need: 'I need to feel heard.',
      request: 'Would you put it down when we talk after dinner?',
    } },
  ],
};
for (const m of MODELS) m.examples = EXAMPLES[m.id] || [];

/** The examples for a writer (kid or grown-up), and the one at `index` (it wraps around). */
export function exampleFor(model, role, index = 0) {
  const pool = model.examples.filter((e) => e.for === (role === 'kid' ? 'kid' : 'adult'));
  const list = pool.length ? pool : model.examples;
  if (!list.length) return { fields: {}, index: 0, count: 0 };
  const i = ((index % list.length) + list.length) % list.length;
  return { fields: list[i].fields, index: i, count: list.length };
}

export const MAX_FIELD_LENGTH = 2000;

export function getModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

// Every style, in the order to offer them: for kids, the kid-friendly ones first and the grown-up ones last.
const KID_ORDER = { kid: 0, all: 1, adult: 2 };
export function modelsFor(role) {
  return role === 'kid' ? [...MODELS].sort((a, b) => KID_ORDER[a.audience] - KID_ORDER[b.audience]) : MODELS;
}

// Returns { ok, errors, clean } where clean contains only known, trimmed fields.
export function validateFields(model, fields) {
  const errors = [];
  const clean = {};
  const input = fields && typeof fields === 'object' ? fields : {};
  for (const f of model.fields) {
    const raw = input[f.key];
    if (f.type === 'choice' && f.multiple) {
      // A list of options; a single value (older messages, simple clients) counts as a list of one.
      const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
      const picked = [...new Set(list)];
      if (picked.some((v) => !f.options.some((o) => o.value === v))) errors.push(`“${f.label}”: pick from the options.`);
      // Kept in the options' order, whatever order they were tapped in.
      else if (picked.length) clean[f.key] = f.options.map((o) => o.value).filter((v) => picked.includes(v));
      if (f.required && !picked.length) errors.push(`Please answer “${f.label}”.`);
      continue;
    }
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v.length > MAX_FIELD_LENGTH) errors.push(`“${f.label}” is too long (max ${MAX_FIELD_LENGTH} characters).`);
    if (f.type === 'choice' && v && !f.options.some((o) => o.value === v)) errors.push(`“${f.label}”: pick one of the options.`);
    if (f.required && !v) errors.push(`Please answer “${f.label}”.`);
    if (v) clean[f.key] = v;
  }
  return { ok: errors.length === 0, errors, clean };
}
