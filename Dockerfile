FROM oven/bun:1 as base
WORKDIR /app

FROM base as install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY prisma ./prisma
COPY . .
RUN bunx --bun prisma generate

FROM base AS release
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["sh", "-c", "bunx --bun prisma migrate deploy && bun run start"]