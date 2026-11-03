/**
 * Turns a Jev routing decision into instructions for the UI generator.
 *
 * Jev decides HOW a prompt gets built (which lane, which structural pieces it
 * needs). The model still decides how it LOOKS: the style family is passed as a
 * hint for the design brief, never as a fixed template.
 */
import type { RenderMode, ToolboxComponent, DesignSystem } from '../shared/toolbox.ts';

export interface GenerateOptions {
  /** Forced render lane from a Jev route. */
  lane?: RenderMode;
  /** Structural pieces Jev judged the UI needs. */
  components?: ToolboxComponent[];
  /** Jev's style family, used only as a hint for the design brief. */
  style?: DesignSystem;
}

const LANE_RULE: Record<RenderMode, string> = {
  registry: 'Use ONLY registry components (no ReactArtifact, no CustomWidget). Include a "theme".',
  sandboxed_react: 'Return a tree with exactly ONE ReactArtifact node that holds the whole UI.',
};

const COMPONENT_HINT: Record<ToolboxComponent, string> = {
  stepper: 'a step-by-step flow with clear progress',
  table: 'a data table (sortable, many records with the same fields)',
  drawer: 'a side drawer to view or edit one item without leaving the list',
  citation_viewer: 'visible sources or evidence behind claims',
  approval_card: 'an explicit confirm step before any irreversible action',
};

const STYLE_HINT: Record<DesignSystem, string> = {
  editorial_serif: 'reading-first, editorial',
  ops_console: 'dense work tool for staff',
  soft_consumer: 'friendly consumer app',
};

export const LANE_LABEL: Record<RenderMode, string> = {
  registry: 'registry components',
  sandboxed_react: 'sandboxed React',
};

/** Extra lines appended to the user turn. Empty when there is nothing to add. */
export function routeHints(opts?: GenerateOptions): string {
  if (!opts) return '';
  const lines: string[] = [];
  if (opts.lane) lines.push(`- Render lane: ${LANE_RULE[opts.lane]}`);
  if (opts.components?.length) lines.push(`- It needs: ${opts.components.map((c) => COMPONENT_HINT[c]).join('; ')}.`);
  if (opts.style) lines.push(`- Audience/style family (a hint for your design brief, not a template): ${STYLE_HINT[opts.style]}.`);
  return lines.length ? `\n\nROUTING (decided by the toolbox router, follow it):\n${lines.join('\n')}` : '';
}

export function isRenderMode(v: unknown): v is RenderMode {
  return v === 'registry' || v === 'sandboxed_react';
}
