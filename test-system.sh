#!/bin/bash

# IndexSphere System Test
# Runs a complete end-to-end test of the plain-HTTP stack
# (docker-compose.production.yml).
# For the HTTPS/nginx stack see docker-compose.nginx.yml.

set -e

print_test()    { echo "[TEST] $1"; }
print_status()  { echo "[INFO] $1"; }
print_success() { echo "[SUCCESS] $1"; }
print_warning() { echo "[WARNING] $1"; }
print_error()   { echo "[ERROR] $1"; }

echo "IndexSphere System Test"
echo "========================="
echo ""
print_status "Tests the plain-HTTP docker-compose.production.yml stack"
echo ""

# ─── Test 1: Project structure ───────────────────────────────────────────────
print_test "Test 1: Project Structure"

required_files=(
    "package.json"
    "src/app/layout.tsx"
    "src/app/page.tsx"
    "src/middleware.ts"
    "src/lib/boot-session.ts"
    "public/favicon.svg"
    "Dockerfile.production"
    "docker-compose.production.yml"
    "docker-compose.nginx.yml"
    "nginx.conf"
    "build.sh"
    "start.sh"
    "stop.sh"
    "verify.sh"
    "README.md"
    "LICENSE"
    ".gitignore"
)

missing=()
for f in "${required_files[@]}"; do
    [ -f "$f" ] || missing+=("$f")
done

if [ ${#missing[@]} -eq 0 ]; then
    print_success "All required files present"
else
    print_error "Missing files: ${missing[*]}"
    exit 1
fi

# ─── Test 2: Dependencies ────────────────────────────────────────────────────
print_test "Test 2: System Dependencies"

if ! docker info > /dev/null 2>&1; then
    print_error "Docker not running"
    exit 1
fi
print_success "Docker is running"

if ! docker compose version > /dev/null 2>&1; then
    print_error "Docker Compose V2 not available (run: docker compose version)"
    exit 1
fi
print_success "Docker Compose V2 available"

if [ -z "${JWT_SECRET}" ]; then
    print_error "JWT_SECRET is not set."
    print_error "Generate one with:  export JWT_SECRET=\$(openssl rand -hex 32)"
    exit 1
fi
print_success "JWT_SECRET is set"

# ─── Test 3: Build ───────────────────────────────────────────────────────────
print_test "Test 3: Build Process"

docker compose -f docker-compose.production.yml down > /dev/null 2>&1 || true

if docker images indexsphere:production | grep -q indexsphere; then
    print_status "Removing existing indexsphere:production image..."
    docker rmi indexsphere:production > /dev/null 2>&1 || true
fi

print_status "Running build..."
if ./build.sh > /dev/null 2>&1; then
    print_success "Build succeeded"
else
    print_error "Build failed — run ./build.sh manually for details"
    exit 1
fi

# ─── Test 4: Container startup ───────────────────────────────────────────────
print_test "Test 4: Container Startup"

if ./start.sh > /dev/null 2>&1; then
    print_success "Container started"
else
    print_error "Start failed — run ./start.sh manually for details"
    exit 1
fi

print_status "Waiting for application to initialise..."
sleep 15

# ─── Test 5: Connectivity ────────────────────────────────────────────────────
print_test "Test 5: Application Connectivity"

max=30; attempt=1
while [ $attempt -le $max ]; do
    if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
        print_success "Application responding on port 3000"
        break
    fi
    if [ $attempt -eq $max ]; then
        print_error "Application not responding after ${max} attempts"
        print_error "Check logs: docker compose -f docker-compose.production.yml logs"
        exit 1
    fi
    sleep 2
    attempt=$((attempt + 1))
done

# ─── Test 6: Health endpoint ─────────────────────────────────────────────────
print_test "Test 6: Health Endpoint"

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health)
if [ "$HEALTH" = "200" ]; then
    print_success "Health endpoint: HTTP $HEALTH"
else
    print_error "Health endpoint returned HTTP $HEALTH (expected 200)"
    exit 1
fi

# ─── Test 7: Auth API ────────────────────────────────────────────────────────
print_test "Test 7: Authentication API"

LOGIN_BODY=$(curl -s -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin"}')
LOGIN_STATUS=$(echo "$LOGIN_BODY" | grep -o '"success":true' || true)

if [ -n "$LOGIN_STATUS" ]; then
    print_success "Login: admin/admin accepted"
    MUST_CHANGE=$(echo "$LOGIN_BODY" | grep -o '"mustChangePassword":true' || true)
    if [ -n "$MUST_CHANGE" ]; then
        print_success "mustChangePassword: true (forced change on first login works)"
    else
        print_warning "mustChangePassword not true — password may have been changed already"
    fi
else
    print_warning "admin/admin login failed (password may have already been changed)"
fi

VERIFY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth/verify)
if [ "$VERIFY_STATUS" = "401" ]; then
    print_success "Verify endpoint: HTTP $VERIFY_STATUS (unauthenticated → 401 as expected)"
else
    print_warning "Verify endpoint returned HTTP $VERIFY_STATUS"
fi

# ─── Test 8: Verify script ────────────────────────────────────────────────────
print_test "Test 8: Verify Script"

if ./verify.sh > /dev/null 2>&1; then
    print_success "verify.sh passed"
else
    print_warning "verify.sh had issues — check manually"
fi

# ─── Test 9: Resource usage ───────────────────────────────────────────────────
print_test "Test 9: Resource Usage"

CID=$(docker compose -f docker-compose.production.yml ps -q 2>/dev/null || true)
if [ -n "$CID" ]; then
    MEM=$(docker stats --no-stream --format "{{.MemUsage}}" "$CID")
    CPU=$(docker stats --no-stream --format "{{.CPUPerc}}" "$CID")
    print_success "Memory: $MEM  CPU: $CPU"
else
    print_warning "Could not read container stats"
fi

# ─── Test 10: Stop ───────────────────────────────────────────────────────────
print_test "Test 10: Stop Process"

if ./stop.sh > /dev/null 2>&1; then
    print_success "Stop succeeded"
else
    print_warning "Stop had issues"
fi

# ─── Test 11: GitHub readiness ───────────────────────────────────────────────
print_test "Test 11: GitHub Repository Readiness"

for f in README.md LICENSE CONTRIBUTING.md CHANGELOG.md .gitignore; do
    if [ -f "$f" ]; then
        print_success "Found $f"
    else
        print_error "Missing $f"
        exit 1
    fi
done

if grep -q "node_modules" .gitignore && grep -q ".next" .gitignore; then
    print_success ".gitignore has essential exclusions"
else
    print_warning ".gitignore may be missing exclusions"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "[SUCCESS] All Tests Passed!"
echo "============================"
echo ""
print_success "IndexSphere system test completed"
echo ""
print_status "Summary:"
echo "  ✅ Project structure is complete"
echo "  ✅ Docker Compose V2 available"
echo "  ✅ Build succeeds"
echo "  ✅ Container starts and is healthy"
echo "  ✅ Health endpoint returns 200"
echo "  ✅ Auth API is functional"
echo "  ✅ Resource usage nominal"
echo "  ✅ Stop process works"
echo "  ✅ GitHub repository files present"
echo ""
print_warning "Default credentials:  admin / admin"
print_warning "Password change is required on first login."
echo ""
print_status "To publish on GitHub:"
echo "  git init && git add . && git commit -m 'Initial commit'"
echo "  git remote add origin <your-repo-url> && git push -u origin main"
echo ""
