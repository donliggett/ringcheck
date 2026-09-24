export const SERVICES = ['cnam', 'carrier'];
export const PROVIDERS = ['telnyx', 'twilio'];

export const DEFAULT_CONFIG = {
  services: {
    cnam: { enabled: true, provider: 'telnyx' },
    carrier: { enabled: true, provider: 'telnyx' },
  },
  // USD per request, US numbers. Check your provider's pricing page and edit.
  prices: {
    telnyx: { cnam: 0.003, carrier: 0.0025 },
    twilio: { cnam: 0.01, carrier: 0.008 },
  },
  monthlyCapUsd: 2.0,
  cacheDays: { cnam: 30, carrier: 7 },
};

const CONFIG_KEY = 'config';

function clone(o) { return JSON.parse(JSON.stringify(o)); }

/** Merge a partial config onto a base, keeping only known keys and valid values. */
export function mergeConfig(base, patch) {
  const out = clone(base);
  if (!patch || typeof patch !== 'object') return { config: out, errors: [] };
  const errors = [];

  if (patch.services && typeof patch.services === 'object') {
    for (const s of SERVICES) {
      const p = patch.services[s];
      if (!p || typeof p !== 'object') continue;
      if ('enabled' in p) {
        if (typeof p.enabled === 'boolean') out.services[s].enabled = p.enabled;
        else errors.push(`services.${s}.enabled must be true or false`);
      }
      if ('provider' in p) {
        if (PROVIDERS.includes(p.provider)) out.services[s].provider = p.provider;
        else errors.push(`services.${s}.provider must be one of ${PROVIDERS.join(', ')}`);
      }
    }
  }
  if (patch.prices && typeof patch.prices === 'object') {
    for (const pr of PROVIDERS) {
      for (const s of SERVICES) {
        const v = patch.prices[pr] && patch.prices[pr][s];
        if (v === undefined) continue;
        if (typeof v === 'number' && v >= 0 && v < 1) out.prices[pr][s] = v;
        else errors.push(`prices.${pr}.${s} must be a number from 0 to 1`);
      }
    }
  }
  if ('monthlyCapUsd' in patch) {
    const v = patch.monthlyCapUsd;
    if (typeof v === 'number' && v >= 0 && v <= 1000) out.monthlyCapUsd = Math.round(v * 100) / 100;
    else errors.push('monthlyCapUsd must be a number from 0 to 1000');
  }
  if (patch.cacheDays && typeof patch.cacheDays === 'object') {
    for (const s of SERVICES) {
      const v = patch.cacheDays[s];
      if (v === undefined) continue;
      if (Number.isInteger(v) && v >= 1 && v <= 365) out.cacheDays[s] = v;
      else errors.push(`cacheDays.${s} must be a whole number from 1 to 365`);
    }
  }
  return { config: out, errors };
}

export async function getConfig(env) {
  let stored = null;
  try { stored = await env.RINGCHECK_KV.get(CONFIG_KEY, 'json'); } catch { stored = null; }
  return mergeConfig(DEFAULT_CONFIG, stored).config;
}

export async function saveConfig(env, patch) {
  const current = await getConfig(env);
  const { config, errors } = mergeConfig(current, patch);
  if (errors.length) return { ok: false, errors };
  await env.RINGCHECK_KV.put(CONFIG_KEY, JSON.stringify(config));
  return { ok: true, config };
}

/** Which providers have credentials set as Worker secrets. */
export function providerAvailability(env) {
  return {
    telnyx: Boolean(env.TELNYX_API_KEY),
    twilio: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
  };
}
