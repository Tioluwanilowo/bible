/**
 * test-openai.mjs
 *
 * Standalone terminal test for the OpenAI Chat Completions endpoint.
 * Mirrors the exact request ChatGPTInterpreter.ts sends so you can
 * see the raw API response without launching Electron.
 *
 * Usage:
 *   node scripts/test-openai.mjs <YOUR_OPENAI_API_KEY> [model]
 *
 * Examples:
 *   node scripts/test-openai.mjs sk-proj-abc123
 *   node scripts/test-openai.mjs sk-proj-abc123 gpt-4o-mini
 *   node scripts/test-openai.mjs sk-proj-abc123 gpt-4.1-nano
 */

const apiKey = process.argv[2];
const model  = process.argv[3] ?? 'gpt-4o-mini';

if (!apiKey) {
  console.error('Usage: node scripts/test-openai.mjs <OPENAI_API_KEY> [model]');
  process.exit(1);
}

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const messages = [
  {
    role: 'system',
    content:
      'You are a Bible reference detection assistant. Return ONLY valid JSON on a single line. ' +
      'Example: {"command":"set_reference","confidence":0.95,"book":"John","chapter":3,"verse":16}',
  },
  {
    role: 'user',
    content:
      'CONFIRMED: none\n' +
      'PENDING: none\n\n' +
      'RECENT TRANSCRIPTS (oldest first, last is most recent):\n' +
      '[1] "Turn to John chapter 3 verse 16"\n\n' +
      'Return JSON for the LAST transcript.',
  },
];

const body = {
  model,
  messages,
  max_completion_tokens: 256,
};

console.log('══════════════════════════════════════════════════');
console.log('  ScriptureFlow — OpenAI API diagnostic test');
console.log('══════════════════════════════════════════════════');
console.log(`  Endpoint : ${ENDPOINT}`);
console.log(`  Model    : ${model}`);
console.log(`  API key  : ${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`);
console.log('──────────────────────────────────────────────────');
console.log('Request body:');
console.log(JSON.stringify(body, null, 2));
console.log('──────────────────────────────────────────────────');

let res;
try {
  res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
} catch (networkErr) {
  console.error('NETWORK ERROR — could not reach OpenAI:');
  console.error(networkErr);
  process.exit(1);
}

console.log(`HTTP status: ${res.status} ${res.statusText}`);
console.log('──────────────────────────────────────────────────');

const raw = await res.text();
console.log('Raw response body:');
console.log(raw);
console.log('──────────────────────────────────────────────────');

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error('FAILED to parse response as JSON:', e.message);
  process.exit(1);
}

console.log('Parsed JSON (pretty):');
console.log(JSON.stringify(data, null, 2));
console.log('──────────────────────────────────────────────────');

// ── finish_reason check ───────────────────────────────────────────────────────
const finishReason = data?.choices?.[0]?.finish_reason;
const reasoningTokens = data?.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
const completionTokens = data?.usage?.completion_tokens ?? 0;
if (finishReason === 'length') {
  console.warn(`⚠️  finish_reason = "length"  — ran out of max_completion_tokens!`);
  console.warn(`   reasoning_tokens used: ${reasoningTokens} / ${completionTokens} total completion tokens`);
  console.warn(`   Increase max_completion_tokens so reasoning + output both fit.`);
} else {
  console.log(`finish_reason: ${finishReason}  (reasoning_tokens: ${reasoningTokens})`);
}
console.log('──────────────────────────────────────────────────');

// ── Field probe — mirrors ChatGPTInterpreter.ts exactly ──────────────────────
const pathOutputText  = data?.output_text;
const pathOutputArray = data?.output?.[0]?.content?.[0]?.text;
const pathChoices     = data?.choices?.[0]?.message?.content;

const fmt = (v) =>
  v !== undefined && v !== null
    ? `✅ string(${String(v).length})  "${String(v).slice(0, 80)}"`
    : `❌ ${v}`;

console.log('Field probe (same logic as ChatGPTInterpreter.ts):');
console.log(`  output_text               → ${fmt(pathOutputText)}`);
console.log(`  output[0].content[0].text → ${fmt(pathOutputArray)}`);
console.log(`  choices[0].message.content → ${fmt(pathChoices)}`);
console.log('──────────────────────────────────────────────────');

const content = pathOutputText ?? pathOutputArray ?? pathChoices ?? '';
console.log(`Extracted content: length=${content.length}`);
if (content) {
  console.log(`Content: "${content}"`);
  console.log('');
  console.log('✅  API returned content — interpreter should work.');
} else {
  const topKeys = Object.keys(data ?? {}).join(', ');
  console.error(`❌  ALL PATHS EMPTY.  Top-level keys: [${topKeys}]`);
  if (data?.output  !== undefined) console.error('  data.output  =', JSON.stringify(data.output));
  if (data?.choices !== undefined) console.error('  data.choices =', JSON.stringify(data.choices));
  console.error('');
  console.error('Possible causes:');
  console.error('  1. Model name does not exist / you have no access to it');
  console.error('  2. The API returned a different field structure (see Raw above)');
  console.error('  3. Content filtering triggered a refusal with no text');
}
console.log('══════════════════════════════════════════════════');
