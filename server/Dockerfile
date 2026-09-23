FROM node:22-slim

# Reminders fire by the server's local time, and cloud hosts run in UTC.
# tzdata lets TZ pick the zone; override TZ in the host's variables if needed.
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Almaty

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Mount persistent storage at /app/data (on Railway: Attach Volume; the
# Dockerfile VOLUME instruction is rejected there).
ENV DATA_DIR=/app/data

EXPOSE 3000
CMD ["node", "server.js"]
