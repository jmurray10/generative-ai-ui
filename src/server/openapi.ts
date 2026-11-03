/** OpenAPI 3.0 document served at /openapi.json and rendered by Swagger UI at /docs. */
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'GenUI Playground API',
    version: '0.1.0',
    description:
      'Generate and serve declarative UI specs. A spec is rendered client-side by a ' +
      'whitelisted component registry plus a reactive state layer (safe expression ' +
      'evaluation, no `eval`); richer output runs in sandboxed iframes — a vanilla-JS ' +
      'CustomWidget or a freeform React+Tailwind ReactArtifact. A spec may carry an ' +
      'optional `theme` and the model\'s `design` brief, and multi-screen requests are ' +
      'planned→expanded into a tabbed app. `/api/decide` asks the Jev toolbox router how ' +
      'to build a prompt (route / ask / hold) and `/api/chat` lets a user talk to a built ' +
      'UI: the answer can operate it (acts run in the browser) or rebuild it. A separate ' +
      'WebSocket at `/voice` exposes a Grok speech-to-speech agent with the same tools ' +
      '(read_ui, act_ui, refine_ui, generate_ui); OpenAPI does not model WS.',
  },
  servers: [{ url: '/', description: 'this server' }],
  tags: [
    { name: 'generation', description: 'Turn a prompt into a UI spec' },
    { name: 'routing', description: 'Jev toolbox decision for a prompt' },
    { name: 'interaction', description: 'Chat with and operate a built UI' },
    { name: 'gallery', description: 'Example prompts (the model generates each UI live)' },
    { name: 'system', description: 'Health and metadata' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['system'],
        summary: 'Liveness check',
        responses: {
          '200': {
            description: 'Service is up',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
              },
            },
          },
        },
      },
    },
    '/api/examples': {
      get: {
        tags: ['gallery'],
        summary: 'List example prompts',
        responses: {
          '200': {
            description: 'Array of examples',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Example' } },
              },
            },
          },
        },
      },
    },
    '/api/generate': {
      post: {
        tags: ['generation'],
        summary: 'Generate a UI spec from a prompt',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GenerateRequest' },
              examples: {
                tip: { value: { prompt: 'a tip calculator that splits the bill' } },
                counter: { value: { prompt: 'a counter with plus and minus buttons' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Generated spec',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/GenerateResponse' } },
            },
          },
          '400': { description: 'Missing or invalid prompt' },
        },
      },
    },
    '/api/stream': {
      post: {
        tags: ['generation'],
        summary: 'Generate or refine a spec, streamed node-by-node (SSE)',
        description:
          'Server-Sent Events. Generates (or, when `spec` is supplied, refines) the full spec, ' +
          'then emits it progressively for a "watch it build" reveal. Prompts that read as ' +
          'multi-screen (deck/onboarding/wizard/flow/…) are planned into screens, generated ' +
          'independently, and assembled into a tabbed app. Events: `meta` ' +
          '({title, initialState, count, source}), one `node` per top-level node ({index, node}), ' +
          'then `done` ({spec}); `error` ({error}) on failure.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StreamRequest' },
              examples: {
                generate: { value: { prompt: 'a pomodoro timer with a task list' } },
                refine: { value: { prompt: 'make it dark and add a reset button', spec: { tree: [] } } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'An SSE stream of meta/node/done events',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/api/decide': {
      post: {
        tags: ['routing'],
        summary: 'Decide how to build a prompt (Jev)',
        description:
          'Jev (TypeSafe) answers typed questions about the prompt; code-owned policy turns them into ' +
          '`route` (lane, needed components, style family), `ask` (one question) or `hold` ' +
          '(injection, contradiction, low confidence, router error). Without TYPESAFE_API_KEY a Grok ' +
          'judge answers the same questions. Pass `answered: true` after one answer: the policy then ' +
          'routes or holds and never asks again.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['prompt'],
                properties: { prompt: { type: 'string' }, answered: { type: 'boolean' } },
              },
              examples: { drums: { value: { prompt: 'a 16-step drum machine with tempo control' } } },
            },
          },
        },
        responses: {
          '200': { description: 'Decision envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/DecisionEnvelope' } } } },
          '400': { description: 'Missing or invalid prompt' },
        },
      },
    },
    '/api/chat': {
      post: {
        tags: ['interaction'],
        summary: 'One chat turn with the live UI',
        description:
          'Send what the screen shows (`readable`), what can be operated (`controls`, ids like ' +
          '`set:rate`, `press:reset`, `call:play`) and the message. The reply may carry `acts` for the ' +
          'client to run in place, or a rebuilt `spec` when the request changes design or structure.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChatRequest' },
              examples: {
                operate: {
                  value: {
                    message: 'Set the rate to 6.25%',
                    readable: 'Rate 6.5%. Payment $2,840.',
                    controls: [{ id: 'set:rate', kind: 'number', label: 'Interest rate', min: 0, max: 15, value: 6.5 }],
                    spec: { title: 'Mortgage', tree: [] },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Reply, acts and/or a rebuilt spec', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatResponse' } } } },
          '400': { description: 'Missing or invalid message' },
          '502': { description: 'The model did not answer' },
        },
      },
    },
  },
  components: {
    schemas: {
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          generator: { type: 'string', enum: ['stub', 'grok', 'gemini'], example: 'grok' },
          model: { type: 'string', nullable: true, example: 'grok-4.7' },
          voice: { type: 'string', enum: ['off', 'grok', 'gemini'], example: 'grok' },
          voiceModel: { type: 'string', nullable: true, example: 'grok-voice-latest' },
          decider: { type: 'string', enum: ['jev', 'grok', 'none'], example: 'jev' },
          uptime: { type: 'number', example: 12.3 },
        },
      },
      GenerateRequest: {
        type: 'object',
        required: ['prompt'],
        properties: { prompt: { type: 'string', example: 'a tip calculator' } },
      },
      StreamRequest: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', example: 'a pomodoro timer' },
          spec: { $ref: '#/components/schemas/UISpec' },
          lane: { type: 'string', enum: ['registry', 'sandboxed_react'], description: 'From a Jev route' },
          components: { type: 'array', items: { type: 'string', enum: ['stepper', 'table', 'drawer', 'citation_viewer', 'approval_card'] } },
          style: { type: 'string', enum: ['editorial_serif', 'ops_console', 'soft_consumer'], description: 'A hint for the design brief, not a template' },
        },
        description: 'Provide `spec` to refine an existing UI; omit it to generate a new one. `lane`/`components`/`style` pass a Jev route through.',
      },
      UIAction: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['set', 'increment', 'toggle', 'reset'] },
          key: { type: 'string' },
          value: {},
        },
      },
      UINode: {
        type: 'object',
        required: ['id', 'type'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', example: 'Card' },
          props: { type: 'object', additionalProperties: true },
          bind: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'prop name -> expression evaluated against live state',
          },
          children: { type: 'array', items: { $ref: '#/components/schemas/UINode' } },
        },
      },
      UITheme: {
        type: 'object',
        description:
          'Optional design tokens. Applied as scoped CSS variables to the registry UI, ' +
          'through a deterministic WCAG contrast pass that guarantees legible text. ' +
          'Sandboxed lanes (CustomWidget/ReactArtifact) theme themselves.',
        properties: {
          bg: { type: 'string', example: '#0f1729' },
          surface: { type: 'string', example: '#1e293b' },
          text: { type: 'string', example: '#f1f5f9' },
          muted: { type: 'string', example: '#94a3b8' },
          accent: { type: 'string', example: '#38bdf8' },
          border: { type: 'string' },
          font: { type: 'string', description: 'a Google Font family', example: 'Schibsted Grotesk' },
        },
      },
      UIDesign: {
        type: 'object',
        description: 'The design brief the model commits to before building.',
        properties: {
          direction: { type: 'string', example: 'Bauhaus' },
          fonts: { type: 'string', example: 'Syne 500/800' },
          palette: { type: 'array', items: { type: 'string' }, example: ['#F2EDE4', '#141414', '#E4402F'] },
          signature: { type: 'string', example: 'primary shapes frame a huge clock' },
        },
      },
      UISpec: {
        type: 'object',
        required: ['tree'],
        properties: {
          design: { $ref: '#/components/schemas/UIDesign' },
          title: { type: 'string' },
          initialState: { type: 'object', additionalProperties: true },
          theme: { $ref: '#/components/schemas/UITheme' },
          tree: { type: 'array', items: { $ref: '#/components/schemas/UINode' } },
        },
      },
      Example: {
        type: 'object',
        description: 'An example prompt (no canned spec) — the model generates from it live.',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          prompt: { type: 'string' },
          blurb: { type: 'string' },
          lane: { type: 'string', enum: ['registry', 'react', 'sandbox'] },
          tryIt: { type: 'array', items: { type: 'string' }, description: 'Things to say to the built UI' },
        },
      },
      DecisionEnvelope: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          decision: {
            type: 'object',
            description: '`{kind:"route", designSystem, renderMode, components, checks, evidence}` | `{kind:"ask", slot, prompt, evidence}` | `{kind:"hold", reason, evidence}`',
            additionalProperties: true,
          },
          source: { type: 'string', enum: ['jev', 'grok_fallback', 'none'] },
          model: { type: 'string', nullable: true },
          ms: { type: 'number' },
          why: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      UIControl: {
        type: 'object',
        required: ['id', 'kind', 'label'],
        properties: {
          id: { type: 'string', example: 'set:rate' },
          kind: { type: 'string', enum: ['number', 'boolean', 'text', 'choice', 'button', 'action'] },
          label: { type: 'string' },
          value: {},
          min: { type: 'number' },
          max: { type: 'number' },
          options: { type: 'array', items: {} },
          description: { type: 'string' },
          params: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
      ChatRequest: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          spec: { $ref: '#/components/schemas/UISpec' },
          readable: { type: 'string', description: 'What the screen currently shows' },
          controls: { type: 'array', items: { $ref: '#/components/schemas/UIControl' } },
          history: { type: 'array', items: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] }, text: { type: 'string' } } } },
        },
      },
      ChatResponse: {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          acts: { type: 'array', items: { type: 'object', properties: { action: { type: 'string' }, value: {}, args: { type: 'object' } } } },
          change: { type: 'string', enum: ['none', 'refine', 'generate'] },
          spec: { $ref: '#/components/schemas/UISpec' },
          ok: { type: 'boolean' },
        },
      },
      GenerateResponse: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          source: { type: 'string', enum: ['stub', 'grok', 'gemini'] },
          degraded: { type: 'boolean', description: 'True when the spec is the connect-a-model notice.' },
          spec: { $ref: '#/components/schemas/UISpec' },
        },
      },
    },
  },
} as const;
