/**
 * Extract the first complete, balanced JSON value from a model response.
 * String- and escape-aware, so prose or a trailing fenced block cannot
 * swallow the payload the way a greedy `\{[\s\S]*\}` match can.
 */
export function extractJSON(text: string): string {
  let src = text;
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (/^\s*[{[]/.test(m[1])) {
      src = m[1];
      break;
    }
  }
  const start = src.search(/[{[]/);
  if (start < 0) return src.trim();
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start).trim();
}
