export function cacheKey(service, e164) {
  return `c:${service}:${e164}`;
}

export async function getCached(env, service, e164) {
  try {
    return await env.RINGCHECK_KV.get(cacheKey(service, e164), 'json');
  } catch {
    return null;
  }
}

export async function putCached(env, service, e164, value, days) {
  const ttl = Math.max(60, Math.round(days * 86400));
  await env.RINGCHECK_KV.put(
    cacheKey(service, e164),
    JSON.stringify({ ...value, fetchedAt: new Date().toISOString() }),
    { expirationTtl: ttl },
  );
}
