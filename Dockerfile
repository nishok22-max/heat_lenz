# HeatLens as one container: the FastAPI backend also serves the built React frontend
# (backend/app/main.py::_serve_frontend), so the whole app is one URL on one port.
#
#   docker build -t heatlens .
#   docker run -p 8000:8000 heatlens      ->  http://localhost:8000
#
# Hosts that set $PORT (Render, Railway, Cloud Run, Hugging Face Spaces) are respected.

# ---- 1. build the frontend
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. the app
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY backend/requirements-runtime.txt backend/requirements-runtime.txt
RUN pip install --no-cache-dir -r backend/requirements-runtime.txt

# Only what the running app reads (see backend/app/core/config.py).
COPY backend/app backend/app
COPY backend/rules backend/rules
COPY htsi htsi
COPY results results
COPY datasets/open_meteo/ahmedabad_hourly_full_2010_2024_clean.csv datasets/open_meteo/
COPY datasets/health datasets/health
COPY datasets/census/DDW-2400C-13.xls datasets/census/
COPY --from=web /web/dist frontend/dist

RUN useradd --create-home heatlens && chown -R heatlens /app
USER heatlens
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT}"]
