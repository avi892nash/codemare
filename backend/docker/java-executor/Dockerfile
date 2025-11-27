FROM eclipse-temurin:21-jdk-alpine

# Install Python for the executor script
RUN apk add --no-cache python3

# Set working directory
WORKDIR /app

# Copy executor script
COPY executor.py /app/executor.py

# Make executor executable
RUN chmod +x /app/executor.py

# Create non-root user for security
RUN adduser -D executor

# Create /tmp directory with proper permissions
RUN mkdir -p /tmp && chmod 777 /tmp

# Change ownership of the app directory to executor user
RUN chown -R executor:executor /app

# Switch to non-root user
USER executor

# Set entrypoint
ENTRYPOINT ["python3", "/app/executor.py"]
