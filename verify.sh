#!/bin/bash

# IndexSphere Deployment Verification Script
# Verifies the plain-HTTP stack (docker-compose.production.yml) is running correctly.
# For the HTTPS/nginx stack, check:
#   docker compose -f docker-compose.nginx.yml ps

set -e

print_status()  { echo "[INFO] $1"; }
print_success() { echo "[SUCCESS] $1"; }
print_warning() { echo "[WARNING] $1"; }
print_error()   { echo "[ERROR] $1"; }

echo "Verifying IndexSphere Deployment"
echo "================================="

# Docker running?
print_status "Checking Docker daemon..."
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running: sudo systemctl start docker"
    exit 1
fi
print_success "Docker is running"

# In project root?
if [ ! -f "docker-compose.production.yml" ]; then
    print_error "Run this script from the IndexSphere project root"
    exit 1
fi
print_success "Project root confirmed"

# Containers running?
print_status "Checking container status..."
if ! docker compose -f docker-compose.production.yml ps | grep -q "Up"; then
    print_error "IndexSphere container is not running — start it with: ./start.sh"
    exit 1
fi
print_success "Container is up"

CID=$(docker compose -f docker-compose.production.yml ps -q)
STATUS=$(docker inspect --format='{{.State.Status}}' "$CID")
if [ "$STATUS" != "running" ]; then
    print_error "Container state: $STATUS"
    print_error "Check logs: docker compose -f docker-compose.production.yml logs"
    exit 1
fi
print_success "Container state: $STATUS"

# Health endpoint
print_status "Checking /api/health..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
    print_success "Health endpoint: HTTP $HEALTH"
else
    print_error "/api/health returned HTTP $HEALTH (expected 200)"
    print_error "Check logs: docker compose -f docker-compose.production.yml logs"
    exit 1
fi

# Main page
print_status "Checking main page..."
MAIN=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
if [ "$MAIN" = "200" ]; then
    print_success "Main page: HTTP $MAIN"
else
    print_error "Main page returned HTTP $MAIN"
    exit 1
fi

# Auth endpoint
print_status "Checking auth endpoint..."
AUTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth/verify 2>/dev/null || echo "000")
if [ "$AUTH" = "401" ]; then
    print_success "Auth/verify endpoint: HTTP $AUTH (unauthenticated → 401 as expected)"
elif [ "$AUTH" = "200" ]; then
    print_success "Auth/verify endpoint: HTTP $AUTH (authenticated session active)"
else
    print_warning "Auth/verify returned HTTP $AUTH"
fi

# Resource usage
print_status "Resource usage..."
MEM=$(docker stats --no-stream --format "table {{.MemUsage}}" "$CID" | tail -1)
CPU=$(docker stats --no-stream --format "table {{.CPUPerc}}" "$CID" | tail -1)
print_status "Memory: $MEM"
print_status "CPU:    $CPU"

CONTAINER_NAME=$(docker compose -f docker-compose.production.yml ps --services)

echo ""
echo "[SUCCESS] Verification Complete!"
echo "================================="
echo ""
print_success "IndexSphere is running correctly"
echo ""
print_status "Details:"
echo "  URL:       http://localhost:3000"
echo "  Container: $CONTAINER_NAME"
echo "  State:     $STATUS"
echo "  Memory:    $MEM"
echo "  CPU:       $CPU"
echo ""
print_warning "Default credentials:  admin / admin"
print_warning "A password change is required on first login."
echo ""
print_status "Commands:"
echo "  Logs:      docker compose -f docker-compose.production.yml logs -f"
echo "  Stop:      ./stop.sh"
echo "  Restart:   ./stop.sh && ./start.sh"
echo ""
