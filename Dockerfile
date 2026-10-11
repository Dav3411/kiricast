# Generator 전용 (Railway Root Directory 비움일 때 사용).
# ffmpeg 설치 보장 — nixpacks.toml / Railpack이 적용되지 않을 때 대안.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV PORT=8000
EXPOSE $PORT
CMD uvicorn local_server:app --host 0.0.0.0 --port ${PORT}
