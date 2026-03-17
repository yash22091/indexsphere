#!/bin/bash

# IndexSphere Stop Script
# Stops the plain-HTTP stack (docker-compose.production.yml).
# For the HTTPS/nginx stack use:
#   docker compose -f docker-compose.nginx.yml down

set -e

echo "Stopping IndexSphere..."

if [ ! -f "docker-compose.production.yml" ]; then
    echo "[ERROR] Please run this script from the IndexSphere project root"
    exit 1
fi

docker compose -f docker-compose.production.yml down

echo "[SUCCESS] IndexSphere stopped."
echo ""
echo "[INFO] Data is preserved in the 'indexsphere-data' Docker volume."
echo "[INFO] To start again: ./start.sh"
echo "[INFO] To remove all data: docker volume rm indexsphere-main_indexsphere-data"
