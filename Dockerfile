FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY . .
RUN npm run build -w packages/shared && npm run build -w packages/api

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3001
ENV WEB_DIST_DIR=/app/packages/web/dist
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/packages/api/scripts ./packages/api/scripts
COPY --from=build /app/packages/api/data ./packages/api/data
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /data
EXPOSE 3001
ENTRYPOINT ["/app/docker-entrypoint.sh"]
