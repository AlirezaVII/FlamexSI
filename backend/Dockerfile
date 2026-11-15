FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 FALMEX_DATA_DIR=/data

COPY pyproject.toml ./
COPY falmex ./falmex
COPY review_seed ./review_seed
COPY scripts/seed_review_workspace.py ./scripts/seed_review_workspace.py
RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["sh", "-c", "python scripts/seed_review_workspace.py && uvicorn falmex.api:app --host 0.0.0.0 --port 8000"]
