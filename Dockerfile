FROM node:24-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
EXPOSE 3001
CMD ["node", "server.js"]
