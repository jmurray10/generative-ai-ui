/**
 * DESIGN.md files live in design/<dir>/DESIGN.md next to a tokens.css. The
 * chosen DESIGN.md is passed verbatim into grok-4.7's instructions on both
 * render paths. Registry UIs then omit "theme": the token file carries the look.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_SYSTEMS, type DesignSystem, type RenderMode } from '../shared/toolbox.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = new Map<DesignSystem, string>();

export function designMarkdown(id: DesignSystem): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const entry = DESIGN_SYSTEMS.find((d) => d.id === id);
  if (!entry) throw new Error(`unknown design system ${id}`);
  const md = readFileSync(join(ROOT, 'design', entry.dir, 'DESIGN.md'), 'utf8');
  cache.set(id, md);
  return md;
}

const LANE_RULE: Record<RenderMode, string> = {
  registry: 'RENDER PATH: registry. Use ONLY registry components. Do NOT use ReactArtifact or CustomWidget.',
  sandboxed_react: 'RENDER PATH: sandboxed React. Return a tree with exactly ONE ReactArtifact node that holds the whole UI.',
};

/** Extra instructions appended to SYSTEM_PROMPT for a design system and/or a forced lane. */
export function designInstructions(id: DesignSystem | undefined, lane: RenderMode | undefined): string {
  const parts: string[] = [];
  if (lane) parts.push(LANE_RULE[lane]);
  if (id) {
    parts.push(
      'ACTIVE DESIGN SYSTEM. Follow this DESIGN.md exactly; it overrides the THEME guidance above.',
      '<<<DESIGN.md',
      designMarkdown(id).trim(),
      'DESIGN.md>>>',
      'Registry UIs: OMIT "theme". The app applies this design system\'s token file, and the registry reads tokens only.',
      'ReactArtifact: implement the DESIGN.md with Tailwind arbitrary values (e.g. bg-[#FAF7F2], font-[\'Newsreader\']) and load its fonts with a <link rel="stylesheet"> to fonts.googleapis.com inside the component.',
    );
  }
  return parts.length ? `\n\n${parts.join('\n')}\n` : '';
}
