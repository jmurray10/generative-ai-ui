/**
 * Only genuinely multi-page asks use the plan→expand path.
 * A single interactive quiz, or a generative "flow field", stays one screen.
 */
const MULTI_PAGE = [
  /\b(deck|slides?|presentation|onboarding|wizard|walkthrough|stepper)\b/i,
  /\bmulti[\s-]?(screen|step|page)s?\b/i,
  /\bseveral\s+(screens|pages|steps)\b/i,
  /\b\d+\s+(screens|pages|steps)\b/i,
  /\b(onboarding|signup|sign-up|checkout|step-by-step|multi-step)\s+flow\b/i,
  /\bflow\s+of\s+(screens|pages|steps)\b/i,
  /\bmulti[\s-]?page\s+(quiz|survey)\b/i,
];

export function isMultiScreenPrompt(prompt: string): boolean {
  return MULTI_PAGE.some((pattern) => pattern.test(prompt));
}
