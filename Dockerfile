FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV NEXT_PUBLIC_API_URL="" \
    FALMEX_BACKEND_URL="http://127.0.0.1:8000" \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS node-runtime

FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FALMEX_DATA_DIR=/data \
    NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY backend/ ./backend/
RUN pip install --no-cache-dir ./backend

COPY --from=frontend-build /build/.next/standalone ./frontend/
COPY --from=frontend-build /build/.next/static ./frontend/.next/static
COPY --from=frontend-build /build/public ./frontend/public
COPY deploy/start-preview.sh ./start-preview.sh

VOLUME ["/data"]
EXPOSE 3000
CMD ["bash", "/app/start-preview.sh"]
