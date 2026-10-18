FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-runtime.txt .
COPY requirements-api.txt .

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --upgrade pip && \
    pip install --extra-index-url https://download.pytorch.org/whl/cu128 \
    -r requirements-runtime.txt && \
    pip install -r requirements-api.txt

COPY credential ./credential
COPY detector ./detector
COPY model ./model
COPY policy ./policy
COPY runtime ./runtime
COPY manifest.json README.md api.py ./

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
