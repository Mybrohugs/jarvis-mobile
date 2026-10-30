// Keep every word while respecting each voice service's request limit.
export function chunks(text, limit) {
  if (!Number.isInteger(limit) || limit < 1) { throw new RangeError('positive chunk limit required'); }
  const normalized = text.replace(/\s+/g, ' ').trim();
  const sentences = normalized.match(/[^.!?…]+[.!?…]*|[.!?…]+/g) || [];
  const out = [];
  let current = '';
  for (const sentence of sentences) {
    let rest = sentence.trim();
    if (current && current.length + 1 + rest.length <= limit) {
      current += ' ' + rest;
      continue;
    }
    if (current) { out.push(current); current = ''; }
    while (rest.length > limit) {
      let at = rest.lastIndexOf(' ', limit);
      if (at <= 0) { at = limit; }
      out.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    current = rest;
  }
  if (current) { out.push(current); }
  return out;
}
