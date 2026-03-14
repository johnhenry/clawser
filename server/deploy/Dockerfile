FROM node:20-slim
WORKDIR /app

# Copy package files first for layer caching
COPY server/signaling/package.json server/signaling/package-lock.json* ./signaling/
COPY server/relay/package.json server/relay/package-lock.json* ./relay/
COPY server/kernel/package.json server/kernel/package-lock.json* ./kernel/

RUN cd signaling && npm install --omit=dev \
 && cd ../relay && npm install --omit=dev \
 && cd ../kernel && npm install --omit=dev

# Copy source
COPY server/signaling/*.mjs ./signaling/
COPY server/relay/*.mjs ./relay/
COPY server/kernel/*.mjs ./kernel/

# Run as non-root
USER node

EXPOSE 8787 8788

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://localhost:8787/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "signaling/index.mjs"]
