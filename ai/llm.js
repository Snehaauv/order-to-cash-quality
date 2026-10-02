import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(here, 'cache');

// LLM wrapper with a response cache keyed by prompt hash. Live calls need ANTHROPIC_API_KEY and --live.

const cachePathFor = (prompt, model) =>
  join(CACHE_DIR, `${createHash('sha256').update(`${model}\n${prompt}`).digest('hex').slice(0, 16)}.json`);

export const DEFAULT_MODEL = 'claude-sonnet-5';

export const complete = async ({ prompt, model = DEFAULT_MODEL, live = false, label = 'response' }) => {
  const cachePath = cachePathFor(prompt, model);

  if (!live) {
    if (existsSync(cachePath)) {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      return { ...cached, source: 'cache', cachePath };
    }
    const fallback = join(CACHE_DIR, `${label}.json`);
    if (existsSync(fallback)) {
      const cached = JSON.parse(readFileSync(fallback, 'utf8'));
      return { ...cached, source: 'cache-fallback', cachePath: fallback };
    }
    throw new Error(
      `No cached response for this prompt and --live was not passed.\n` +
        `Either run with --live and ANTHROPIC_API_KEY set, or restore ${fallback}.`,
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('--live requires ANTHROPIC_API_KEY in the environment.');
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const payload = {
    model,
    text: response.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
    usage: response.usage,
    recordedAt: new Date().toISOString(),
  };

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
  writeFileSync(join(CACHE_DIR, `${label}.json`), JSON.stringify(payload, null, 2), 'utf8');

  return { ...payload, source: 'live', cachePath };
};

// Extracts the JSON array from the model response.
export const extractJsonArray = (text) => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('model response contained no JSON array');
  }
  return JSON.parse(candidate.slice(start, end + 1));
};
