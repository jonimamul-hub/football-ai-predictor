// AI — Football Assistant
// Two modes with distinct system prompts:
//   lbr      — signals, learning, signal lifecycle
//   analysis — match analysis, predictions, verdicts

const Anthropic = require('@anthropic-ai/sdk');

const SIGNAL_QUALITY_GUIDE = `
Signal quality levels (Council-assigned):
  [Ideal]   — strong evidence, confirmed 2+ seasons, >70% hit rate
  [Good]    — solid evidence, 55–70% hit rate, understood WHY
  [Weak]    — emerging pattern, 40–55%, limited data
  [Dormant] — unconfirmed or <40% hit rate — ignore in predictions

Learning (automatic after results):
  WIN  → each matched signal moves UP one level (Dormant→Weak→Good→Ideal)
  LOSE → each matched signal moves DOWN one level (Ideal→Good→Weak→Dormant)
`;

function buildSystem(mode, signals, context) {
  const sigSummary = signals.length
    ? signals.map(s =>
        `  [${s.type}/${s.category}/${s.level}] ${s.name}${s.note ? ` — ${s.note}` : ''}`
      ).join('\n')
    : '  (none yet)';

  let system;

  if (mode === 'lbr') {
    system =
      `You are an LBR (League-Based Research) signal expert for a football prediction system.\n\n` +
      `Your domain: the signal library — what signals exist, why they predict BTTS or Draw, ` +
      `how they are discovered, and how they evolve through the learning lifecycle.\n\n` +
      SIGNAL_QUALITY_GUIDE +
      `\nCurrent signals in the system:\n${sigSummary}\n\n` +
      `Help the user:\n` +
      `- Understand what each signal means and the WHY mechanism behind it\n` +
      `- Evaluate whether a signal's current quality level seems accurate\n` +
      `- Suggest new signals worth researching for specific leagues\n` +
      `- Explain how learning calibrates signal levels over time\n` +
      `- Identify signal combinations (patterns) that reliably co-occur\n` +
      `- Discuss signal lifecycle: discovery → calibration → retirement\n\n` +
      `Be specific and reference signal names and levels directly. Think like a researcher.`;
  } else {
    system =
      `You are a match prediction analyst for a BTTS and Draw prediction system.\n\n` +
      `Your domain: applying signals to specific matches, evaluating prediction confidence, ` +
      `and reasoning through verdicts.\n\n` +
      SIGNAL_QUALITY_GUIDE +
      `\nVerdicts:\n` +
      `  BTTS:  YES (confident both score) | NO (confident one/both blank) | SKIP-B (insufficient evidence)\n` +
      `  Draw:  DRAW | NO_DRAW | SKIP-B\n` +
      `  Rule:  SKIP-B requires a mandatory reason. Never force a verdict on weak evidence.\n\n` +
      `Current signals in the system:\n${sigSummary}\n\n` +
      `Help the user:\n` +
      `- Analyze specific matches — which signals apply, which contradict\n` +
      `- Evaluate prediction confidence and recommend verdict\n` +
      `- Review past predictions and explain what signals were decisive\n` +
      `- Identify matches worth tracking vs matches to skip\n` +
      `- Discuss head-to-head context, form, motivation\n\n` +
      `Be decisive. Give a clear verdict with reasoning. Reference signal levels.`;
  }

  if (context) system += `\n\nAdditional context from user:\n${context}`;
  return system;
}

async function runAssistant(messages, { context = '', signals = [], mode = 'analysis' } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const resp = await client.messages.create({
    model:      'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system:     buildSystem(mode, signals, context),
    messages,
  });

  return resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

module.exports = { runAssistant };
