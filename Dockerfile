# GenUI Playground: frontend and backend as separate images from one Dockerfile.
#
#   docker compose up --build          web (nginx, :8080) + api (Express, internal :8080)
#   docker build --target api  .       API only: /api, /voice, /docs (no client)
#   docker build --target web  .       static client + reverse proxy to the API
#   docker build --target all  .       the old single container (API + client on one port)
#
# The web image proxies /api, /voice (WebSocket), /docs and /openapi.json to the
# API, so the browser sees one origin: no CORS, and SSE + WebSockets just work.

# ---- shared: install dependencies once ------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- api: Express + tsx, no client bundle ---------------------------------
FROM deps AS api
COPY tsconfig*.json ./
COPY src ./src
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["npm", "start"]

# ---- build the client (Vite -> dist/client) -------------------------------
FROM deps AS client-build
COPY . .
RUN npm run build

# ---- web: static client behind nginx --------------------------------------
FROM nginx:1.27-alpine AS web
# Rendered by the image's entrypoint (envsubst) into /etc/nginx/conf.d/default.conf.
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=client-build /app/dist/client /usr/share/nginx/html
ENV API_UPSTREAM=api:8080
ENV PORT=8080
EXPOSE 8080

# ---- all: single container, API serves the client (default target) --------
FROM deps AS all
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
