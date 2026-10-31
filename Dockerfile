# Hosted Streamable HTTP MCP transport; expose only behind authenticated TLS proxy.
FROM node:20-slim
ENV NODE_ENV=production \
    GH_PROJECTS_HTTP_HOST=0.0.0.0 \
    GH_PROJECTS_HTTP_PORT=3000 \
    GH_PROJECTS_HTTP_REQUIRE_AUTH=true \
    GH_PROJECTS_DISABLE_BROWSER_UI=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server-http.mjs ./
COPY lib/ ./lib/
USER node
EXPOSE 3000
CMD ["node", "server-http.mjs"]
