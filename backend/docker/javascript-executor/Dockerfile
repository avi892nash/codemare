FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy executor script
COPY executor.js /app/executor.js

# Make executor executable
RUN chmod +x /app/executor.js

# Create non-root user for security
RUN adduser -D executor

# Change ownership of the app directory to executor user
RUN chown -R executor:executor /app

# Switch to non-root user
USER executor

# Set entrypoint
ENTRYPOINT ["node", "/app/executor.js"]
