/**
 * Pull a JSON value out of a model response.
 * String- and escape-aware, so a brace inside a string cannot end the value.
 * If the model emits more than one JSON value, the most complete object wins
 * and the drop is reported — a short leading object used to hide the rest.
 */

export interface JSONExtract {
  json: string;
  warnings: string[];
}

interface Slice {
  json: string;
  end: number;
}

export function extractJSON(text: string): string {
  return inspectJSON(text).json;
}

export function inspectJSON(text: string): JSONExtract {
  const fenced = firstFencedJSON(text);
  const src = fenced ?? text;
  const slices = topLevelJSON(src);
  if (slices.length === 0) {
    return { json: src.trim(), warnings: ['No JSON value found in the model response.'] };
  }

  let chosen = slices[0];
  let best = scoreJSON(chosen.json);
  for (const slice of slices.slice(1)) {
    const score = scoreJSON(slice.json);
    if (score > best) {
      chosen = slice;
      best = score;
    }
  }

  const warnings: string[] = [];
  if (slices.length > 1) {
    warnings.push(
      `Model returned ${slices.length} JSON values; kept the most complete one (${chosen.json.length} chars) and dropped the rest.`,
    );
  }
  const trailing = src.slice(chosen.end).trim();
  if (trailing) {
    warnings.push(`Dropped ${trailing.length} characters of trailing content after the JSON value: ${trailing.slice(0, 120)}`);
  }
  return { json: chosen.json, warnings };
}

function firstFencedJSON(text: string): string | null {
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (/^\s*[{[]/.test(match[1])) return match[1];
  }
  return null;
}

function topLevelJSON(src: string): Slice[] {
  const slices: Slice[] = [];
  let i = 0;
  while (i < src.length) {
    const start = src.slice(i).search(/[{[]/);
    if (start < 0) break;
    const at = i + start;
    const end = closeAt(src, at);
    if (end < 0) {
      slices.push({ json: src.slice(at).trim(), end: src.length });
      break;
    }
    slices.push({ json: src.slice(at, end), end });
    i = end;
  }
  return slices;
}

function closeAt(src: string, start: number): number {
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
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function scoreJSON(json: string): number {
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return json.length;
    const obj = value as Record<string, unknown>;
    const nodes = Array.isArray(obj.tree) ? countNodes(obj.tree) : 0;
    const stateKeys = obj.initialState && typeof obj.initialState === 'object'
      ? Object.keys(obj.initialState as object).length
      : 0;
    return nodes * 1000 + stateKeys * 10 + Object.keys(obj).length;
  } catch {
    return -1;
  }
}

function countNodes(nodes: unknown[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    if (node && typeof node === 'object' && Array.isArray((node as { children?: unknown }).children)) {
      n += countNodes((node as { children: unknown[] }).children);
    }
  }
  return n;
}
