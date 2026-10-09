FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV VITE_DEMO_MODE=false VITE_API_BASE_URL=/api
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 telecom \
    && mkdir -p /app/data \
    && chown telecom:telecom /app/data
COPY --chown=telecom:telecom backend/ ./backend/
COPY --from=frontend-build --chown=telecom:telecom /app/frontend/dist/ ./frontend/dist/
USER telecom
EXPOSE 8000
CMD ["python", "-m", "backend"]
