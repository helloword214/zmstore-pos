# ---------- Build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps (clean & reproducible)
COPY package*.json ./
RUN npm ci

# Prisma (needed for build + runtime schema)
COPY prisma ./prisma
RUN npx prisma generate

# Copy app code and build
COPY . .
ENV NODE_ENV=production
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only ship what we need
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Start your Remix app (same as your package.json "start")
CMD ["npm", "run", "start"]
