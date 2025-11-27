# Kubernetes Deployment for Codemare Backend

This directory contains Kubernetes manifests for deploying the Codemare backend to a Kubernetes cluster.

## Prerequisites

- Kubernetes cluster (k3s, Minikube, or managed cluster)
- kubectl configured to access your cluster
- Nginx Ingress Controller installed
- cert-manager installed (for SSL certificates)

## Files

- `namespace.yaml` - Creates the codemare namespace
- `configmap.yaml` - Environment configuration
- `deployment.yaml` - Main application deployment with Docker-in-Docker sidecar
- `service.yaml` - Internal service for the backend
- `ingress.yaml` - External access and SSL termination
- `deploy.sh` - Deployment automation script

## Docker-in-Docker Architecture

The deployment uses a Docker-in-Docker (DinD) sidecar pattern:
- **backend container**: Runs the Node.js application
- **dind container**: Runs Docker daemon for code execution

The backend connects to the DinD sidecar via `tcp://localhost:2375`.

## Quick Start

### 1. Update Configuration

Edit `configmap.yaml` and `ingress.yaml` with your domain:

```yaml
# configmap.yaml
data:
  ALLOWED_ORIGINS: "https://your-actual-domain.com"

# ingress.yaml
spec:
  tls:
    - hosts:
        - api.your-actual-domain.com
  rules:
    - host: api.your-actual-domain.com
```

### 2. Build and Push Docker Image

```bash
# Build production image
docker build -f ../Dockerfile.production -t your-registry/codemare-backend:latest ..

# Push to registry
docker push your-registry/codemare-backend:latest
```

### 3. Update Deployment

Edit `deployment.yaml` to use your image:

```yaml
spec:
  template:
    spec:
      containers:
        - name: backend
          image: your-registry/codemare-backend:latest  # Update this
```

### 4. Deploy

```bash
# Deploy all resources
./deploy.sh

# Or manually:
kubectl apply -f .
```

### 5. Verify Deployment

```bash
# Check pods
kubectl get pods -n codemare

# Check logs
kubectl logs -n codemare -l app=codemare-backend -f

# Check service
kubectl get svc -n codemare

# Check ingress
kubectl get ingress -n codemare
```

## Installation on Different Platforms

### k3s (Recommended for VPS)

```bash
# Install k3s
curl -sfL https://get.k3s.io | sh -

# Get kubeconfig
sudo cat /etc/rancher/k3s/k3s.yaml > ~/.kube/config

# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

### Minikube (Local Testing)

```bash
# Start Minikube
minikube start --cpus=4 --memory=8192

# Enable ingress
minikube addons enable ingress

# Deploy
./deploy.sh
```

### Managed Kubernetes (DigitalOcean, GKE, etc.)

```bash
# Configure kubectl with your cluster
# (follow cloud provider instructions)

# Install Nginx Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/cloud/deploy.yaml

# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Deploy
./deploy.sh
```

## Scaling

### Horizontal Scaling

```bash
# Scale to 3 replicas
kubectl scale deployment/codemare-backend -n codemare --replicas=3
```

### Resource Limits

Edit `deployment.yaml` to adjust resource limits:

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "500m"
```

## Monitoring

### View Logs

```bash
# All pods
kubectl logs -n codemare -l app=codemare-backend -f

# Specific container in pod
kubectl logs -n codemare POD_NAME -c backend -f
kubectl logs -n codemare POD_NAME -c dind -f
```

### Get Pod Details

```bash
kubectl describe pod -n codemare -l app=codemare-backend
```

### Check Resource Usage

```bash
kubectl top pods -n codemare
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod -n codemare -l app=codemare-backend

# Check logs
kubectl logs -n codemare -l app=codemare-backend --all-containers=true
```

### Docker Executor Issues

```bash
# Check DinD container logs
kubectl logs -n codemare POD_NAME -c dind

# Exec into pod to test Docker
kubectl exec -it -n codemare POD_NAME -c backend -- sh
# Inside pod:
apk add docker-cli
docker ps
```

### Ingress Not Working

```bash
# Check ingress status
kubectl describe ingress -n codemare codemare-backend

# Check ingress controller logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller -f
```

## Cleanup

```bash
# Delete all resources
kubectl delete namespace codemare

# Or delete individual resources
kubectl delete -f .
```

## Security Notes

- The DinD sidecar requires `privileged: true` to run Docker daemon
- Ensure your cluster security policy allows privileged containers
- The backend runs as non-root user (node)
- Network policies can be added for additional isolation
- Consider using PodSecurityPolicy or Pod Security Standards

## Cost Optimization

### For Low Traffic

- Use single replica: `replicas: 1`
- Reduce resource requests:
  ```yaml
  requests:
    memory: "256Mi"
    cpu: "100m"
  ```

### For Production

- Use HorizontalPodAutoscaler for auto-scaling
- Implement PodDisruptionBudget for high availability
- Use node affinity to optimize resource usage
