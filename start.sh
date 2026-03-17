#!/bin/bash

# IndexSphere Production Start Script (plain HTTP on port 3000)
# For HTTPS+nginx, use:  docker compose -f docker-compose.nginx.yml up -d

set -e

print_status()  { echo "[INFO] $1"; }
print_success() { echo "[SUCCESS] $1"; }
print_warning() { echo "[WARNING] $1"; }
print_error()   { echo "[ERROR] $1"; }

echo "Starting IndexSphere Production Server..."
echo "==========================================="

# Verify we are in the project root
if [ ! -f "docker-compose.production.yml" ]; then
    print_error "docker-compose.production.yml not found."
    print_error "Run this script from the IndexSphere project root."
    exit 1
fi
print_success "Found docker-compose.production.yml"

# Verify JWT_SECRET
if [ -z "${JWT_SECRET}" ]; then
    print_error "JWT_SECRET is not set."
    print_error "Generate one with:  export JWT_SECRET=\$(openssl rand -hex 32)"
    exit 1
fi
print_success "JWT_SECRET is set"

# Verify Docker
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running.  Start it first: sudo systemctl start docker"
    exit 1
fi
print_success "Docker is running"

# Auto-build if image is missing
if ! docker images indexsphere:production | grep -q indexsphere; then
    print_warning "indexsphere:production image not found — building now..."
    echo ""
    ./build.sh
    echo ""
fi

# Stop any existing containers cleanly
print_status "Stopping any previous containers..."
docker compose -f docker-compose.production.yml down > /dev/null 2>&1 || true

# Start services
print_status "Starting IndexSphere..."
if docker compose -f docker-compose.production.yml up -d; then
    print_success "Services started!"
else
    print_error "Failed to start.  Run ./build.sh first."
    exit 1
fi

# Brief wait for the process to bind
print_status "Waiting for the application to initialise..."
sleep 5

if docker compose -f docker-compose.production.yml ps | grep -q "Up"; then
    print_success "IndexSphere is running!"
else
    print_error "Container failed to start."
    print_error "Check logs: docker compose -f docker-compose.production.yml logs"
    exit 1
fi

echo ""
echo "[SUCCESS] IndexSphere is Running!"
echo "========================="
echo ""
print_success "Application URL: http://localhost:3000"
echo ""
print_warning "Default credentials:  admin / admin"
print_warning "You will be prompted to change the password on first login."
echo ""
print_status "Useful commands:"
echo "  View logs:   docker compose -f docker-compose.production.yml logs -f"
echo "  Stop:        ./stop.sh"
echo "  Restart:     ./stop.sh && ./start.sh"
echo ""

read -p "View real-time logs? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    print_status "Showing logs (Ctrl+C to exit)..."
    docker compose -f docker-compose.production.yml logs -f
fi
