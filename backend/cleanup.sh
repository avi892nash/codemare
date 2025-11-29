#!/bin/bash

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

echo "============================================================"
echo "🧹 CODEMARE BACKEND - CLEANUP UTILITY"
echo "============================================================"
log_info "This script will remove all Codemare-related containers, networks, and optionally images"
echo ""

# Show what will be cleaned
log_info "Finding Codemare-related resources..."
echo ""

CONTAINERS=$(docker ps -a --filter "name=backend" --filter "name=codemare" --format "{{.ID}} - {{.Names}} ({{.Status}})" 2>/dev/null)
NETWORKS=$(docker network ls --filter "name=backend" --filter "name=codemare" --format "{{.ID}} - {{.Name}}" 2>/dev/null)
IMAGES=$(docker images --filter "reference=codemare-*" --format "{{.ID}} - {{.Repository}}:{{.Tag}}" 2>/dev/null)

if [ -n "$CONTAINERS" ]; then
    log_info "Containers to be removed:"
    echo "$CONTAINERS"
    echo ""
else
    log_info "No containers found"
fi

if [ -n "$NETWORKS" ]; then
    log_info "Networks to be removed:"
    echo "$NETWORKS"
    echo ""
else
    log_info "No networks found"
fi

if [ -n "$IMAGES" ]; then
    log_warning "Docker images found (will NOT be removed unless you specify --images):"
    echo "$IMAGES"
    echo ""
fi

# Confirm before proceeding
if [ "$1" != "-y" ] && [ "$1" != "--yes" ]; then
    echo -n "Proceed with cleanup? (y/N): "
    read -r response
    if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
        log_info "Cleanup cancelled"
        exit 0
    fi
fi

echo ""
log_info "Starting cleanup..."
echo ""

# Stop and remove containers using docker-compose
log_info "Step 1: Stopping containers via docker-compose..."
if docker compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null; then
    log_success "Docker compose cleanup completed"
else
    log_warning "Docker compose cleanup had issues (this is normal if containers are in bad state)"
fi

# Force remove any remaining containers
log_info "Step 2: Force removing any remaining containers..."
REMOVED_CONTAINERS=$(docker ps -a --filter "name=backend" --filter "name=codemare" -q | xargs -r docker rm -f 2>&1)
if [ $? -eq 0 ]; then
    if [ -n "$REMOVED_CONTAINERS" ]; then
        log_success "Stale containers removed"
    else
        log_info "No stale containers to remove"
    fi
else
    log_warning "Some containers could not be removed (they may already be gone)"
fi

# Remove networks
log_info "Step 3: Removing Docker networks..."
REMOVED_NETWORKS=$(docker network ls --filter "name=backend" --filter "name=codemare" -q | xargs -r docker network rm 2>&1)
if [ $? -eq 0 ]; then
    if [ -n "$REMOVED_NETWORKS" ]; then
        log_success "Networks removed"
    else
        log_info "No networks to remove"
    fi
else
    log_warning "Some networks could not be removed (they may be in use or already gone)"
fi

# Remove images if requested
if [ "$1" = "--images" ] || [ "$2" = "--images" ]; then
    log_info "Step 4: Removing Docker images..."
    REMOVED_IMAGES=$(docker images --filter "reference=codemare-*" -q | xargs -r docker rmi -f 2>&1)
    if [ $? -eq 0 ]; then
        if [ -n "$REMOVED_IMAGES" ]; then
            log_success "Images removed"
        else
            log_info "No images to remove"
        fi
    else
        log_warning "Some images could not be removed"
    fi
else
    log_info "Step 4: Skipping image removal (use --images flag to remove images)"
fi

# Prune system (optional)
if [ "$1" = "--prune" ] || [ "$2" = "--prune" ]; then
    log_info "Step 5: Running Docker system prune..."
    docker system prune -f
    log_success "System prune completed"
else
    log_info "Step 5: Skipping system prune (use --prune flag to clean unused resources)"
fi

echo ""
echo "============================================================"
log_success "CLEANUP COMPLETED!"
echo "============================================================"
echo ""
log_info "Usage options:"
echo "  ./cleanup.sh              - Interactive cleanup (asks for confirmation)"
echo "  ./cleanup.sh -y           - Auto-confirm cleanup"
echo "  ./cleanup.sh --images     - Also remove Docker images"
echo "  ./cleanup.sh --prune      - Also run 'docker system prune'"
echo "  ./cleanup.sh -y --images --prune  - Full cleanup without confirmation"
echo ""
log_info "You can now run ./deploy.sh to redeploy"
echo ""
