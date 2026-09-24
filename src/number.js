// US/NANP number handling. Paid providers and FCC data are US-focused, so
// RingCheck accepts 10-digit NANP numbers (optionally with a leading 1).

const NANP = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

/** Returns "+1NPANXXXXXX" or null. Accepts any punctuation. */
export function toE164(input) {
  if (typeof input !== 'string') return null;
  let d = input.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return null;
  const e164 = '+1' + d;
  if (!NANP.test(e164)) return null;
  if (d.slice(1, 3) === '11') return null; // N11 service codes are not area codes
  return e164;
}
