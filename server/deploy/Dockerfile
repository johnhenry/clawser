FROM node:20-slim
WORKDIR /app
COPY server/ ./
RUN cd signaling && npm ci && cd ../relay && npm ci && cd ../kernel && npm ci
EXPOSE 8787 8788
CMD ["node", "signaling/index.mjs"]
