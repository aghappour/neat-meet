# Local fork: frontend image built from the REPO ROOT context.
#
# Upstream's frontend/Dockerfile builds with context ./frontend, but the type
# check reaches outside that context: frontend/src/app/components/shared/types.ts
# does `import type { ... } from "../../../../../backend/src/lib/..."`, so
# `next build` fails with implicit-any errors when backend/src is absent.
# Building from the repo root lets us copy those backend sources to /backend/src
# where the relative import resolves. Otherwise this mirrors frontend/Dockerfile.
FROM node:22-slim

WORKDIR /app
# Optional egress-inspection CA (gitignored; see frontend/Dockerfile note).
COPY frontend/package*.json frontend/ca-bundle.crt* ./
ENV NODE_EXTRA_CA_CERTS=/app/ca-bundle.crt
RUN npm ci
COPY frontend/ .
# Type-only imports resolve ../../../../../backend from /app/src/app/components/shared.
COPY backend/src /backend/src

# NEXT_PUBLIC_* are inlined at build time, so they must be present during `next build`.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
