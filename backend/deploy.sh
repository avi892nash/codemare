#!/bin/bash
set -e

echo "🚀 Deploying Codemare Backend to Production..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found. Creating from .env.production template..."
    cp .env.production .env
    echo "📝 Please edit .env with your production values before deploying again."
    exit 1
fi

# Build all Docker images
echo "📦 Building Docker images (this may take a few minutes)..."
docker compose -f docker-compose.production.yml build --no-cache

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker compose -f docker-compose.production.yml down

# Start new containers
echo "▶️  Starting containers..."
docker compose -f docker-compose.production.yml up -d

# Wait for backend to be healthy
echo "⏳ Waiting for backend to be healthy..."
sleep 5

# Check health
if curl -sf http://localhost:3000/health > /dev/null; then
    echo "✅ Backend is healthy!"
else
    echo "❌ Health check failed!"
    echo "📋 Recent logs:"
    docker compose -f docker-compose.production.yml logs --tail=50 backend
    exit 1
fi

echo "✅ Deployment complete!"
echo "🌐 Backend running on http://localhost:3000"
echo ""
echo "📊 Container status:"
docker compose -f docker-compose.production.yml ps
echo ""
echo "📋 To view logs: docker-compose -f docker-compose.production.yml logs -f backend"
echo "🛑 To stop: docker-compose -f docker-compose.production.yml down"
