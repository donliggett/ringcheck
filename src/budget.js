// Monthly spend counter in KV. KV is eventually consistent, so two lookups in
// the same second can both pass the cap; at personal volume that is cents.

export function monthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `spend:${y}-${m}`;
}

export async function getSpend(env, date = new Date()) {
  const v = await env.RINGCHECK_KV.get(monthKey(date));
  const n = v === null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function addSpend(env, amount, date = new Date()) {
  if (!(amount > 0)) return getSpend(env, date);
  const total = Math.round(((await getSpend(env, date)) + amount) * 1e6) / 1e6;
  // Keep a little over a year of monthly totals.
  await env.RINGCHECK_KV.put(monthKey(date), String(total), { expirationTtl: 400 * 86400 });
  return total;
}
