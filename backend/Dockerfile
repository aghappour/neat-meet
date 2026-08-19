# ponytail: single stage. LibreOffice dwarfs everything, multi-stage saves little.
FROM node:22-slim

# libreoffice-convert shells out to soffice for doc conversion (see src/lib/convert.ts).
# Local fork: best-effort. Restricted networks (no apt mirror egress) still get a
# working backend; only DOC/DOCX -> PDF conversion is unavailable without soffice.
RUN (apt-get update \
  && apt-get install -y --no-install-recommends libreoffice \
  && rm -rf /var/lib/apt/lists/*) \
  || echo "WARNING: LibreOffice not installed; DOC/DOCX -> PDF conversion disabled"

WORKDIR /app
# Local fork: restricted networks intercept TLS with their own CA. If the build
# context provides ca-bundle.crt (gitignored, copied in by the operator), trust
# it for npm; the glob makes this a no-op when the file is absent, and Node
# merely warns when NODE_EXTRA_CA_CERTS points at a missing file.
COPY package*.json ca-bundle.crt* ./
ENV NODE_EXTRA_CA_CERTS=/app/ca-bundle.crt
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001
CMD ["npm", "start"]
