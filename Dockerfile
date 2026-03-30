# ---- Build stage ----
FROM node:22-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# sharp postinstall script must run — do NOT use --ignore-scripts
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Production stage ----
FROM node:22-alpine AS production

WORKDIR /app

# Copy full node_modules from builder to preserve sharp native binaries
# (same base image ensures ABI compatibility)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/main"]
