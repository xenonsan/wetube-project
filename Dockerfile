FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && chown -R node:node /app/node_modules

COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node views ./views

ENV NODE_ENV=production
ENV PORT=4646

USER node

EXPOSE 4646

CMD ["npm", "start"]
