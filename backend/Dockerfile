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
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001
CMD ["npm", "start"]
