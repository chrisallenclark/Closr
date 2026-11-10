# Closr garment preparation server: API (default command) and worker (python -m closr_server.worker).
# Build from the repository root:  docker build -f server/Dockerfile -t closr-server .
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    U2NET_HOME=/opt/u2net \
    CLOSR_CACHE_DIR=/tmp/closr-cache \
    CLOSR_DATA_DIR=/tmp/closr-data
# (Production keeps nothing on the machine: Postgres and the bucket hold all data. CLOSR_DATA_DIR
#  is only scratch, e.g. the local URL-signing key, which bucket storage doesn't use.)

WORKDIR /app
COPY server/requirements.txt server/requirements.txt
# `--secret id=ca,src=<bundle.pem>` is only for builds behind a TLS-intercepting proxy; hosts don't need it.
RUN --mount=type=secret,id=ca,required=false sh -c '\
    if [ -f /run/secrets/ca ]; then export PIP_CERT=/run/secrets/ca REQUESTS_CA_BUNDLE=/run/secrets/ca SSL_CERT_FILE=/run/secrets/ca; fi; \
    pip install -r server/requirements.txt && \
    python -c "from rembg import new_session; new_session(\"isnet-general-use\")"'
# (The background-removal model is baked in above, so a cold start never downloads it.)

COPY scripts/avatar-prototype/poc scripts/avatar-prototype/poc
COPY server/closr_server server/closr_server

RUN useradd --create-home closr && chown -R closr /opt/u2net
USER closr
WORKDIR /app/server
EXPOSE 8080
CMD ["uvicorn", "closr_server.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
