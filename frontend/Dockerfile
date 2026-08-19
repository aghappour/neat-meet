FROM node:22-slim

WORKDIR /app
# Local fork: restricted networks intercept TLS with their own CA. If the build
# context provides ca-bundle.crt (gitignored, copied in by the operator), trust
# it for npm; the glob makes this a no-op when the file is absent, and Node
# merely warns when NODE_EXTRA_CA_CERTS points at a missing file.
COPY package*.json ca-bundle.crt* ./
ENV NODE_EXTRA_CA_CERTS=/app/ca-bundle.crt
RUN npm ci
COPY . .

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
