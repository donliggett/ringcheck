import { toE164 } from './number.js';
import { SERVICES, getConfig } from './config.js';
import { getCached, putCached } from './cache.js';
import { getSpend, addSpend } from './budget.js';
import { PROVIDER_LOOKUP } from './providers/index.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Run the paid services for one number: cache first, then the budget check,
 * then the provider picked in config. Returns { status, body }.
 */
export async function runLookup(env, input, opts = {}) {
  const { fetchImpl, now = new Date() } = opts;
  const e164 = toE164(input && input.number);
  if (!e164) {
    return { status: 400, body: { error: 'invalid_number', message: 'Enter a 10-digit US number.' } };
  }

  const config = await getConfig(env);
  const requested = Array.isArray(input.services)
    ? [...new Set(input.services.filter((s) => SERVICES.includes(s)))]
    : [];
  const refresh = input.refresh === true;
  const out = { number: e164, costUsd: 0, errors: [] };

  const wanted = [];
  for (const s of requested) {
    if (config.services[s].enabled) wanted.push(s);
    else out.errors.push({ service: s, code: 'service_disabled' });
  }

  const misses = [];
  for (const s of wanted) {
    const hit = refresh ? null : await getCached(env, s, e164);
    if (hit) out[s] = { ...hit, cached: true };
    else misses.push(s);
  }

  let spend = await getSpend(env, now);
  if (misses.length) {
    const estimate = misses.reduce((sum, s) => sum + config.prices[config.services[s].provider][s], 0);
    if (spend + estimate > config.monthlyCapUsd + 1e-9) {
      for (const s of misses) out.errors.push({ service: s, code: 'budget_cap' });
    } else {
      const byProvider = {};
      for (const s of misses) (byProvider[config.services[s].provider] ||= []).push(s);

      let cost = 0;
      await Promise.all(Object.entries(byProvider).map(async ([provider, services]) => {
        const r = await PROVIDER_LOOKUP[provider](e164, services, env, fetchImpl);
        for (const s of services) {
          if (r.results[s]) {
            const value = { ...r.results[s], provider };
            out[s] = { ...value, cached: false };
            await putCached(env, s, e164, value, config.cacheDays[s]);
          }
          if (r.errors[s]) out.errors.push({ service: s, code: r.errors[s], provider });
          if (r.billed.includes(s)) cost += config.prices[provider][s];
        }
      }));

      cost = round6(cost);
      if (cost > 0) spend = await addSpend(env, cost, now);
      out.costUsd = cost;
    }
  }

  out.monthSpendUsd = round6(spend);
  out.monthlyCapUsd = config.monthlyCapUsd;
  return { status: 200, body: out };
}
