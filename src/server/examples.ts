/**
 * Pre-baked example specs. These power both the offline stub generator and the
 * landing-page gallery, so the playground is impressive (and fully functional)
 * even with no API key configured.
 */
import type { Example } from '../shared/spec.ts';

export const examples: Example[] = [
  {
    id: 'tip-calculator',
    title: 'Tip calculator',
    prompt: 'a tip calculator that splits the bill between people',
    blurb: 'Sliders + live computed totals — pure declarative state binding.',
    spec: {
      title: 'Tip Calculator',
      initialState: { bill: 60, tipPct: 18, people: 3 },
      tree: [
        {
          id: 'card',
          type: 'Card',
          props: { title: 'Tip Calculator', subtitle: 'Split the bill in style' },
          children: [
            { id: 's1', type: 'Slider', props: { label: 'Bill', stateKey: 'bill', min: 0, max: 300, step: 1, prefix: '$' } },
            { id: 's2', type: 'Slider', props: { label: 'Tip', stateKey: 'tipPct', min: 0, max: 40, step: 1, suffix: '%' } },
            { id: 's3', type: 'Slider', props: { label: 'People', stateKey: 'people', min: 1, max: 20, step: 1 } },
            {
              id: 'row',
              type: 'Row',
              children: [
                { id: 't1', type: 'Stat', props: { label: 'Total', prefix: '$', decimals: 2 }, bind: { value: 'bill * (1 + tipPct / 100)' } },
                { id: 't2', type: 'Stat', props: { label: 'Per person', prefix: '$', decimals: 2 }, bind: { value: 'bill * (1 + tipPct / 100) / people' } },
                { id: 't3', type: 'Stat', props: { label: 'Tip amount', prefix: '$', decimals: 2 }, bind: { value: 'bill * tipPct / 100' } },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'counter',
    title: 'Counter',
    prompt: 'a counter with plus, minus and reset buttons',
    blurb: 'Buttons dispatch declarative actions against the reactive store.',
    spec: {
      title: 'Counter',
      initialState: { count: 0 },
      tree: [
        {
          id: 'card',
          type: 'Card',
          props: { title: 'Counter', subtitle: 'Actions, not code' },
          children: [
            { id: 'stat', type: 'Stat', props: { label: 'Count', decimals: 0 }, bind: { value: 'count' } },
            {
              id: 'row',
              type: 'Row',
              children: [
                { id: 'dec', type: 'Button', props: { label: '– 1', variant: 'ghost', action: { type: 'increment', key: 'count', value: -1 } } },
                { id: 'inc', type: 'Button', props: { label: '+ 1', action: { type: 'increment', key: 'count', value: 1 } } },
                { id: 'reset', type: 'Button', props: { label: 'Reset', variant: 'ghost', action: { type: 'reset' } } },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'bouncing-ball',
    title: 'Bouncing ball',
    prompt: 'an animated bouncing ball on a canvas',
    blurb: 'The sandboxed escape hatch: arbitrary JS in an isolated iframe.',
    spec: {
      title: 'Bouncing Ball',
      tree: [
        {
          id: 'card',
          type: 'Card',
          props: { title: 'Bouncing Ball', subtitle: 'Rendered in a sandboxed iframe' },
          children: [
            {
              id: 'cw',
              type: 'CustomWidget',
              props: {
                height: 280,
                html: '<canvas id="c" width="520" height="280"></canvas>',
                css: 'html,body{margin:0;background:#0b0b12;overflow:hidden}canvas{display:block}',
                script: [
                  'const cv=document.getElementById("c");const x=cv.getContext("2d");',
                  'let px=80,py=80,vx=2.6,vy=2.0,r=22;',
                  'function loop(){',
                  ' x.fillStyle="#0b0b12";x.fillRect(0,0,cv.width,cv.height);',
                  ' px+=vx;py+=vy;',
                  ' if(px<r||px>cv.width-r)vx*=-1;',
                  ' if(py<r||py>cv.height-r)vy*=-1;',
                  ' const g=x.createRadialGradient(px-6,py-6,4,px,py,r);',
                  ' g.addColorStop(0,"#9d86ff");g.addColorStop(1,"#5b3fd6");',
                  ' x.fillStyle=g;x.beginPath();x.arc(px,py,r,0,7);x.fill();',
                  ' requestAnimationFrame(loop);',
                  '}loop();',
                ].join('\n'),
              },
            },
          ],
        },
      ],
    },
  },
];

export function findExample(prompt: string): Example | null {
  const p = prompt.toLowerCase();
  if (/(tip|bill|gratuity|split)/.test(p)) return byId('tip-calculator');
  if (/(count|counter|increment|tally)/.test(p)) return byId('counter');
  if (/(ball|canvas|bounce|animat|draw|particle)/.test(p)) return byId('bouncing-ball');
  return null;
}

function byId(id: string): Example {
  const e = examples.find((x) => x.id === id);
  if (!e) throw new Error(`example not found: ${id}`);
  return e;
}
