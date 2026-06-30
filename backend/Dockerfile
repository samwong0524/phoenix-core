# ──────────────────────────────────────────────
# Stage 1: Install dependencies
# ──────────────────────────────────────────────
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy dependency manifests only (leverage Docker layer cache)
COPY package.json package-lock.json ./

# Install all deps (including devDependencies for build)
RUN npm ci --ignore-scripts

# ──────────────────────────────────────────────
# Stage 2: Build Next.js application
# ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build with webpack (production mode)
RUN npm run build

# ──────────────────────────────────────────────
# Stage 3: Production runtime (slim image)
# ──────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Security: run as non-root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/public ./public

# Next.js standalone output (if configured) or .next
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/postcss.config.js ./postcss.config.js

# Copy runtime source files (prompts, skills, mcp config)
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/skills ./skills
COPY --from=builder --chown=nextjs:nodejs /app/mcp.json ./mcp.json
COPY --from=builder --chown=nextjs:nodejs /app/app ./app

# Create directories for runtime data
RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3100

# Set hostname
ENV HOSTNAME="0.0.0.0"
ENV PORT=3100
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/api/health || exit 1

# Start
CMD ["node", "node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3100"]
