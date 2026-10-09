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
# A frontend build stage will be added when the React application exists.
USER telecom
EXPOSE 8000
CMD ["python", "-m", "backend"]
