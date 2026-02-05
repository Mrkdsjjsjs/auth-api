#!/bin/bash
# Deploy script for Messenger API

set -e

echo "🚀 Deploying Messenger..."

# Navigate to deploy directory
cd "$(dirname "$0")"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Build Docker images
echo "🔨 Building Docker images..."
docker compose -f docker-compose.prod.yml build

# Stop and remove old containers
echo "🛑 Stopping old containers..."
docker compose -f docker-compose.prod.yml down

# Start new containers
echo "▶️ Starting new containers..."
docker compose -f docker-compose.prod.yml up -d

# Wait for services
echo "⏳ Waiting for services..."
sleep 10

# Check health
echo "🏥 Checking health..."
curl -s http://localhost:8000/health | jq .

echo "✅ Deployment complete!"
echo ""
echo "Services:"
echo "  - Backend: http://localhost:8000"
echo "  - Frontend: http://localhost:3000"
echo "  - API Docs: http://localhost:8000/docs"
