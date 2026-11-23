FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/pq/package.json packages/pq/package.json
COPY packages/coverage packages/coverage
COPY services/watcher services/watcher
RUN npm ci --workspace @canary/watcher --include-workspace-root --ignore-scripts
RUN npm rebuild esbuild
ENV WATCHER_DB=/data/canary-watcher.sqlite
ENV WATCHER_HOST=0.0.0.0
EXPOSE 8787
CMD ["npm", "run", "watcher"]
