#!/bin/bash

# IndexSphere Production Build Script
# Builds the indexsphere:production Docker image.
# By default targets docker-compose.production.yml (plain HTTP).
# For HTTPS/nginx use:  docker compose -f docker-compose.nginx.yml build --no-cache indexsphere

set -e

print_status()  { echo "[INFO] $1"; }
print_success() { echo "[SUCCESS] $1"; }
print_warning() { echo "[WARNING] $1"; }
print_error()   { echo "[ERROR] $1"; }

echo "Building IndexSphere for Production..."
echo "======================================="

# Verify we are in the project root
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Run this script from the IndexSphere project root."
    exit 1
fi
print_success "Found package.json"

for dir in src public; do
    if [ ! -d "$dir" ]; then
        print_error "Required directory '$dir/' not found."
        exit 1
    fi
    print_success "Found $dir/"
done

# Verify Docker
print_status "Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running.  Start it first: sudo systemctl start docker"
    exit 1
fi
print_success "Docker is running"

# Verify JWT_SECRET
if [ -z "${JWT_SECRET}" ]; then
    print_error "JWT_SECRET is not set."
    print_error "Generate one with:  export JWT_SECRET=\$(openssl rand -hex 32)"
    exit 1
fi
print_success "JWT_SECRET is set"

# Clean previous local build artefacts (Docker layer cache is kept)
if [ -d ".next" ]; then
    print_status "Removing stale .next build artefacts..."
    rm -rf .next
fi

# Build the image
print_status "Building Docker image (this may take a few minutes)..."
echo ""

if docker compose -f docker-compose.production.yml build --no-cache; then
    print_success "Docker image built successfully!"
else
    print_error "Docker build failed."
    print_error "Common fixes:"
    print_error "  - Check your internet connection"
    print_error "  - docker system prune -a   (clears Docker cache)"
    exit 1
fi

echo ""
echo "[SUCCESS] Build Completed!"
echo "================================"
echo ""
print_success "indexsphere:production image is ready"
echo ""
print_status "Next steps:"
echo "  Plain HTTP :  ./start.sh"
echo "  HTTPS+nginx:  docker compose -f docker-compose.nginx.yml up -d"
echo ""
print_warning "Default admin credentials:  admin / admin"
print_warning "You will be required to change the password on first login."
echo ""
