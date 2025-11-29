#!/bin/bash
set -e

# Color codes for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions with timestamps
log_info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} ℹ️  $1"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} ✅ $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} ⚠️  $1"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} ❌ $1"
}

log_step() {
    echo ""
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} 🔹 $1"
    echo "============================================================"
}

# Get system info
get_memory_info() {
    if command -v free &> /dev/null; then
        free -h | grep Mem | awk '{print "Available: "$7" / Total: "$2}'
    else
        echo "Memory info not available"
    fi
}

# Main deployment starts
echo "============================================================"
echo "🚀 CODEMARE BACKEND - PRODUCTION DEPLOYMENT"
echo "============================================================"
log_info "Started at: $(date)"
log_info "Working directory: $(pwd)"
log_info "System memory: $(get_memory_info)"
echo ""

# Check if .env file exists
log_step "STEP 1: Validating Environment Configuration"
if [ ! -f .env ]; then
    log_error ".env file not found"
    log_warning "Creating .env from .env.production template..."
    cp .env.production .env
    log_warning "Please edit .env with your production values before deploying again"
    exit 1
fi
log_success "Environment file validated"

# Parse command line arguments
NO_CACHE=""
if [ "$1" = "--no-cache" ]; then
    NO_CACHE="--no-cache"
    log_warning "Building with --no-cache flag (rebuilding all layers)"
    log_warning "This will take significantly longer and use more resources"
else
    log_info "Using cached layers where possible (use --no-cache to force rebuild)"
fi

# Stop existing containers first to free up memory
log_step "STEP 2: Cleaning Up Existing Containers"
log_info "Freeing up system resources before building..."

# Force remove all containers, networks, and volumes related to this project
log_info "Stopping and removing containers..."
docker compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null || true

# Clean up any stale containers that might be left from crashes
log_info "Removing any stale Codemare containers..."
docker ps -a --filter "name=backend" --filter "name=codemare" -q | xargs -r docker rm -f 2>/dev/null || true

# Remove any dangling networks
log_info "Cleaning up Docker networks..."
docker network ls --filter "name=backend" --filter "name=codemare" -q | xargs -r docker network rm 2>/dev/null || true

# Optional: Clean up unused images to free space (commented out by default)
# Uncomment the next line if you want to remove old unused images
# log_info "Pruning unused images..." && docker image prune -f

log_success "Cleanup completed"
log_info "System memory after cleanup: $(get_memory_info)"

# Build Docker images sequentially to prevent memory exhaustion
log_step "STEP 3: Building Docker Images (Sequential)"
log_info "Building images one at a time to prevent memory exhaustion"
log_info "Total images to build: 5 (executors: 4, backend: 1)"
echo ""

TOTAL_IMAGES=5
CURRENT=1

build_image() {
    local service=$1
    local name=$2
    echo ""
    log_info "[$CURRENT/$TOTAL_IMAGES] Building $name..."
    log_info "Memory before build: $(get_memory_info)"

    START_TIME=$(date +%s)

    if docker compose -f docker-compose.production.yml build $NO_CACHE $service; then
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))
        log_success "$name built successfully (took ${DURATION}s)"
    else
        log_error "Failed to build $name"
        log_error "Check the error messages above for details"
        exit 1
    fi

    CURRENT=$((CURRENT + 1))
}

build_image "python-executor" "Python Executor"
build_image "javascript-executor" "JavaScript Executor"
build_image "cpp-executor" "C++ Executor"
build_image "java-executor" "Java Executor"
build_image "backend" "Backend Service"

echo ""
log_success "All images built successfully!"
log_info "Final memory state: $(get_memory_info)"

# Start new containers
log_step "STEP 4: Starting Containers"
log_info "Launching backend and executor services..."
if docker compose -f docker-compose.production.yml up -d; then
    log_success "Containers started"
else
    log_error "Failed to start containers"
    exit 1
fi

# Wait for backend to be healthy
log_step "STEP 5: Health Check"
log_info "Waiting for backend to initialize (5 seconds)..."
sleep 5

MAX_RETRIES=3
RETRY=1

while [ $RETRY -le $MAX_RETRIES ]; do
    log_info "Health check attempt $RETRY/$MAX_RETRIES..."

    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        log_success "Backend is healthy and responding!"
        break
    else
        if [ $RETRY -eq $MAX_RETRIES ]; then
            log_error "Health check failed after $MAX_RETRIES attempts"
            log_error "Showing recent logs:"
            echo ""
            docker compose -f docker-compose.production.yml logs --tail=50 backend
            exit 1
        fi
        log_warning "Health check failed, retrying in 3 seconds..."
        sleep 3
        RETRY=$((RETRY + 1))
    fi
done

# Deployment complete
echo ""
echo "============================================================"
log_success "DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo "============================================================"
log_info "Backend running on: http://localhost:3000"
log_info "Completed at: $(date)"
echo ""

log_info "Container Status:"
docker compose -f docker-compose.production.yml ps
echo ""

log_info "Useful Commands:"
echo "  📋 View logs:        docker compose -f docker-compose.production.yml logs -f backend"
echo "  🔄 Restart:          docker compose -f docker-compose.production.yml restart"
echo "  🛑 Stop:             docker compose -f docker-compose.production.yml down"
echo "  📊 Check status:     docker compose -f docker-compose.production.yml ps"
echo "  🔍 Check health:     curl http://localhost:3000/health"
echo ""
