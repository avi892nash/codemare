FROM node:20-alpine

# Install Docker CLI (for dockerode to work)
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start dev server
CMD ["npm", "run", "dev"]
