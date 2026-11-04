/**
 * Times the Grok stand-in judge for Jev on each model given, on a few prompts.
 *   npx tsx scripts/judge-speed.ts grok-4.20-0309-non-reasoning grok-4.7
 */
import 'dotenv/config';
import { askGrokJudge } from '../src/server/jev/grok-judge.ts';
import { routeToolbox } from '../src/server/jev/policy.ts';

const PROMPTS = [
  'a 16-step drum machine using the Web Audio API with tempo control',
  'a home affordability planner with income, debts, rate and term inputs showing monthly payment',
  'an on-call incident console with an alert queue, filters, a detail drawer and acknowledge actions',
];

const models = process.argv.slice(2);
for (const model of models) {
  process.env.JEV_JUDGE_MODEL = model;
  for (const prompt of PROMPTS) {
    const t0 = Date.now();
    try {
      const { answers } = await askGrokJudge(prompt);
      const d = routeToolbox(answers);
      const what = d.kind === 'route' ? `${d.renderMode} ${d.designSystem} ${d.components.join('+')}` : d.kind === 'ask' ? d.prompt : d.reason;
      console.log(`${model}\t${Date.now() - t0}ms\t${d.kind}\t${what}`);
    } catch (err) {
      console.log(`${model}\t${Date.now() - t0}ms\tERROR\t${(err as Error).message.slice(0, 160)}`);
    }
  }
}
