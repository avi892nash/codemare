FROM python:3.11-alpine

# Set working directory
WORKDIR /app

# Copy executor script
COPY executor.py /app/executor.py

# Make executor executable
RUN chmod +x /app/executor.py

# Create non-root user for security
RUN adduser -D executor

# Change ownership of the app directory to executor user
RUN chown -R executor:executor /app

# Switch to non-root user
USER executor

# Set entrypoint
ENTRYPOINT ["python3", "/app/executor.py"]
