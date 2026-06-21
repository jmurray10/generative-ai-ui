# GenUI Playground — single self-contained image.
# Installs all deps, builds the client, then runs the Express server (via tsx)
# which serves both the API/docs and the built client on one port.
FROM node:22-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci

# Build the client bundle (Vite -> dist/client).
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
