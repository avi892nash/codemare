# Codemare Backend Deployment Guide

Complete guide for deploying the Codemare backend to production.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Phase 1: VPS Deployment (Recommended)](#phase-1-vps-deployment-recommended)
- [Phase 2: Kubernetes Deployment](#phase-2-kubernetes-deployment)
- [Testing](#testing)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Overview

Codemare backend is a LeetCode-style code execution platform that supports Python, JavaScript, C++, and Java. It uses Docker containers for secure sandboxed code execution.

### Architecture

```
Internet → Nginx (SSL) → Backend → Docker Socket → Executor Containers
                           ↓
                    (Python, JS, C++, Java)
```

### Key Features

- 4 language executors (Python, JavaScript, C++, Java)
- Sandboxed code execution with Docker
- Resource limits (256MB RAM, 0.5 CPU, 10s timeout)
- Rate limiting (10 requests/min per IP)
- Health checks and monitoring
- Production-ready security

## Prerequisites

- Git
- Docker and Docker Compose
- Node.js 20+ (for local testing)
- Domain name (for production)
- VPS or Kubernetes cluster

## Phase 1: VPS Deployment (Recommended)

**Cost**: $5-6/month | **Time**: 2-3 hours | **Difficulty**: Easy

### Why VPS First?

- Cheapest option ($5/month Hetzner vs $18+ K8s)
- Fastest to deploy (2 hours vs 2 days)
- Native Docker support (no DinD complexity)
- Perfect for portfolio projects
- Easy migration to K8s later

### 1.1 Choose a VPS Provider

**Recommended:**
- **Hetzner Cloud CX21**: €4.51/month (~$5) - 2 vCPU, 4GB RAM, 40GB SSD
- DigitalOcean: $6/month - 1 vCPU, 1GB RAM
- Vultr: $6/month - 1 vCPU, 1GB RAM

### 1.2 Initial Server Setup

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Update system
apt-get update && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt-get install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

### 1.3 Clone and Configure

```bash
# Clone repository
git clone https://github.com/yourusername/codemare.git
cd codemare/backend

# Create environment file
cp .env.production .env

# Edit with your values
nano .env
```

Update `.env` with:
```env
NODE_ENV=production
PORT=3000
DOCKER_HOST=unix:///var/run/docker.sock
ALLOWED_ORIGINS=https://your-frontend-domain.com
```

### 1.4 Deploy

```bash
# Make deploy script executable
chmod +x deploy.sh

# Deploy (this will build all images and start containers)
./deploy.sh
```

The script will:
1. Build production Docker image
2. Build all 4 executor images
3. Start containers
4. Run health checks

### 1.5 Setup Nginx Reverse Proxy

```bash
# Install Nginx
apt-get install nginx -y

# Create Nginx configuration
nano /etc/nginx/sites-available/codemare
```

Paste this configuration:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Increase timeouts for code execution
        proxy_read_timeout 30s;
        proxy_connect_timeout 30s;
    }
}
```

Enable site:

```bash
# Enable site
ln -s /etc/nginx/sites-available/codemare /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Reload Nginx
systemctl reload nginx
```

### 1.6 Setup SSL with Let's Encrypt

```bash
# Install Certbot
apt-get install certbot python3-certbot-nginx -y

# Get SSL certificate
certbot --nginx -d api.yourdomain.com

# Follow prompts (enter email, agree to ToS)
# Certbot will automatically configure HTTPS
```

### 1.7 Setup Firewall

```bash
# Configure UFW firewall
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable

# Verify status
ufw status
```

### 1.8 Setup Auto-restart

```bash
# Docker containers are already set to restart:unless-stopped
# But let's ensure they start on boot

# Check status
docker-compose -f docker-compose.production.yml ps

# If containers aren't running:
docker-compose -f docker-compose.production.yml up -d
```

### 1.9 Setup CI/CD (Optional)

Add GitHub Secrets in your repository:
- Settings → Secrets and variables → Actions → New repository secret

Add these secrets:
- `VPS_HOST`: Your VPS IP address
- `VPS_USERNAME`: SSH username (usually `root`)
- `VPS_SSH_KEY`: Your private SSH key

The GitHub Actions workflow (`.github/workflows/deploy-backend.yml`) will automatically deploy on push to main.

## Phase 2: Kubernetes Deployment

**Cost**: $13-30/month | **Time**: 4-8 hours | **Difficulty**: Medium-Hard

See [k8s/README.md](k8s/README.md) for detailed Kubernetes deployment instructions.

### Quick Overview

1. **Build and push Docker image**
   ```bash
   docker build -f Dockerfile.production -t your-registry/codemare-backend:latest .
   docker push your-registry/codemare-backend:latest
   ```

2. **Update manifests**
   - Edit `k8s/configmap.yaml` with your domain
   - Edit `k8s/ingress.yaml` with your domain
   - Edit `k8s/deployment.yaml` with your image

3. **Deploy**
   ```bash
   cd k8s
   ./deploy.sh
   ```

### K8s Options

- **k3s on VPS** (FREE, same VPS): Best for learning
- **Minikube** (LOCAL only): Testing
- **DigitalOcean K8s** ($12/month): Easiest managed option
- **GKE/EKS/AKS** ($30+/month): Enterprise grade

## Testing

### Local Testing

```bash
# Run deployment tests
./tests/deployment.test.sh
```

This will:
- Build all Docker images
- Start containers
- Run health checks
- Test all 4 language executors
- Test error handling
- Clean up

### Manual Testing

```bash
# Health check
curl http://your-domain.com/health

# Get problems
curl http://your-domain.com/api/problems

# Execute code
curl -X POST http://your-domain.com/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "two-sum",
    "language": "python",
    "code": "def twoSum(nums, target):\n    return [0, 1]"
  }'
```

## Monitoring

### Check Container Status

```bash
# View running containers
docker-compose -f docker-compose.production.yml ps

# View logs
docker-compose -f docker-compose.production.yml logs -f backend

# Check resource usage
docker stats
```

### Setup Health Monitoring (Free)

1. **UptimeRobot** (https://uptimerobot.com)
   - Free tier: 50 monitors
   - Setup HTTP monitor for https://api.yourdomain.com/health
   - Get alerts via email/SMS

2. **Healthchecks.io**
   - Create cron job:
   ```bash
   # Add to crontab: crontab -e
   */5 * * * * curl -fsS --retry 3 https://api.yourdomain.com/health > /dev/null || docker-compose -f /root/codemare/backend/docker-compose.production.yml restart
   ```

### View Metrics

```bash
# Backend logs
docker logs codemare-backend -f

# Container stats
docker stats codemare-backend

# Disk usage
docker system df
```

## Troubleshooting

### Container Won't Start

```bash
# View logs
docker-compose -f docker-compose.production.yml logs backend

# Check if port 3000 is already in use
netstat -tlnp | grep 3000

# Rebuild and restart
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml up -d --build
```

### Health Check Failing

```bash
# Check if backend is responding
curl http://localhost:3000/health

# Check Docker socket access
docker ps

# View detailed logs
docker logs codemare-backend --tail=100
```

### Executor Fails

```bash
# Check if executor images exist
docker images | grep executor

# Rebuild executor images
docker-compose -f docker-compose.production.yml build

# Test executor directly
echo '{"code":"def twoSum(nums,target):\n  return [0,1]","tests":[{"input":[[1,2],3],"expected":[0,1]}],"functionName":"twoSum"}' | docker run --rm -i codemare-python-executor:latest
```

### Out of Disk Space

```bash
# Check disk usage
df -h

# Clean up Docker
docker system prune -a -f

# Remove old images
docker images prune -a

# Remove stopped containers
docker container prune
```

### SSL Certificate Issues

```bash
# Renew certificate
certbot renew

# Force renew
certbot renew --force-renewal

# Check certificate status
certbot certificates
```

### High Memory Usage

```bash
# Check container memory
docker stats

# Restart containers
docker-compose -f docker-compose.production.yml restart

# Reduce resource limits in docker-compose.production.yml
# (see Docker config for executor containers)
```

## Maintenance

### Updating Code

```bash
# Pull latest code
cd /root/codemare/backend
git pull origin main

# Rebuild and restart
./deploy.sh
```

### Updating Dependencies

```bash
# Update npm packages
npm update

# Rebuild
npm run build

# Redeploy
./deploy.sh
```

### Regular Cleanup

```bash
# Weekly cleanup (add to cron)
0 2 * * 0 docker system prune -f

# Monthly full cleanup
docker system prune -a -f
```

### Backup

```bash
# Backup problems data
tar -czf problems-backup-$(date +%Y%m%d).tar.gz src/data/problems/

# Copy to safe location
scp problems-backup-*.tar.gz user@backup-server:/backups/
```

## Security Best Practices

- ✅ HTTPS only (SSL certificate)
- ✅ Firewall configured (UFW)
- ✅ Rate limiting enabled
- ✅ CORS restricted to specific domains
- ✅ Non-root Docker user
- ✅ Resource limits on executors
- ✅ Network isolation for executors
- ✅ Regular security updates

### Enable Automatic Security Updates

```bash
apt-get install unattended-upgrades -y
dpkg-reconfigure -plow unattended-upgrades
```

## Cost Breakdown

### VPS Deployment

| Item | Monthly Cost |
|------|-------------|
| Hetzner CX21 VPS | $5 |
| Domain | $1 (annual/12) |
| SSL | FREE (Let's Encrypt) |
| **Total** | **$6/month** |

### Kubernetes Deployment

| Item | Monthly Cost |
|------|-------------|
| k3s on VPS | $12 (larger VPS) |
| Managed K8s | $18-30 |
| Domain | $1 |
| SSL | FREE |
| **Total** | **$13-31/month** |

## Next Steps

1. ✅ Backend deployed
2. Deploy frontend (Vercel/Netlify - FREE)
3. Connect frontend to backend API
4. Test end-to-end
5. Add monitoring (UptimeRobot)
6. Setup backups
7. Write documentation
8. Share on portfolio

## Support

- GitHub Issues: https://github.com/yourusername/codemare/issues
- Plan file: `~/.claude/plans/jiggly-wishing-crayon.md`

## License

MIT
