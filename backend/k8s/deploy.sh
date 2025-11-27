#!/bin/bash
set -e

echo "🚀 Deploying Codemare Backend to Kubernetes..."

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl first."
    exit 1
fi

# Apply manifests
echo "📦 Creating namespace..."
kubectl apply -f namespace.yaml

echo "⚙️  Applying ConfigMap..."
kubectl apply -f configmap.yaml

echo "🚀 Deploying application..."
kubectl apply -f deployment.yaml

echo "🌐 Creating service..."
kubectl apply -f service.yaml

echo "🔒 Setting up ingress..."
kubectl apply -f ingress.yaml

# Wait for rollout
echo "⏳ Waiting for deployment to complete..."
kubectl rollout status deployment/codemare-backend -n codemare --timeout=5m

# Show status
echo "✅ Deployment complete!"
echo ""
echo "📊 Pod status:"
kubectl get pods -n codemare

echo ""
echo "🌐 Service status:"
kubectl get svc -n codemare

echo ""
echo "🔒 Ingress status:"
kubectl get ingress -n codemare

echo ""
echo "📋 To view logs:"
echo "  kubectl logs -n codemare -l app=codemare-backend -f"
echo ""
echo "🔍 To check pod details:"
echo "  kubectl describe pod -n codemare -l app=codemare-backend"
