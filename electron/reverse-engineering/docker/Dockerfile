# Imagen opcional para Intel / reversing ligero (strings, file).
# Build: npm run docker:intel-image
# Se usa automáticamente si existe el tag local (sin MCAP_INTEL_DOCKER_IMAGE).
FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends binutils file \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /project
