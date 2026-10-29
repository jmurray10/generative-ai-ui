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
      'optional `theme`, and multi-screen requests are planned→expanded into a tabbed ' +
      'app. A separate WebSocket at `/voice` exposes a Grok speech-to-speech agent ' +
      '(Gemini Live when VOICE_PROVIDER=gemini) that can read and edit the on-screen UI ' +
      '(not described here — OpenAPI does not model WS).',
  },
  servers: [{ url: '/', description: 'this server' }],
  tags: [
    { name: 'generation', description: 'Turn a prompt into a UI spec' },
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
        },
        description: 'Provide `spec` to refine an existing UI; omit it to generate a new one.',
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
          font: { type: 'string', description: 'a Google Font family', example: 'Space Grotesk' },
        },
      },
      UISpec: {
        type: 'object',
        required: ['tree'],
        properties: {
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
