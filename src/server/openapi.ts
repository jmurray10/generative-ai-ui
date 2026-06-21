/** OpenAPI 3.0 document served at /openapi.json and rendered by Swagger UI at /docs. */
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'GenUI Playground API',
    version: '0.1.0',
    description:
      'Generate and serve declarative UI specs. A spec is rendered client-side by a ' +
      'whitelisted component registry plus a reactive state layer (safe expression ' +
      'evaluation, no `eval`). Arbitrary code only runs inside the sandboxed CustomWidget.',
  },
  servers: [{ url: '/', description: 'this server' }],
  tags: [
    { name: 'generation', description: 'Turn a prompt into a UI spec' },
    { name: 'gallery', description: 'Pre-baked example specs' },
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
        summary: 'List pre-baked example specs',
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
          'then emits it progressively for a "watch it build" reveal. Events: `meta` ' +
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
          generator: { type: 'string', enum: ['stub', 'gemini'], example: 'stub' },
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
      UISpec: {
        type: 'object',
        required: ['tree'],
        properties: {
          title: { type: 'string' },
          initialState: { type: 'object', additionalProperties: true },
          tree: { type: 'array', items: { $ref: '#/components/schemas/UINode' } },
        },
      },
      Example: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          prompt: { type: 'string' },
          blurb: { type: 'string' },
          spec: { $ref: '#/components/schemas/UISpec' },
        },
      },
      GenerateResponse: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          source: { type: 'string', enum: ['stub', 'gemini'] },
          spec: { $ref: '#/components/schemas/UISpec' },
        },
      },
    },
  },
} as const;
