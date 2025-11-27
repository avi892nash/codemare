export const DOCKER_CONFIG = {
  // Docker image names for each language
  images: {
    python: 'codemare-python-executor:latest',
    javascript: 'codemare-js-executor:latest',
    cpp: 'codemare-cpp-executor:latest',
    java: 'codemare-java-executor:latest',
  },

  // Resource limits for code execution
  limits: {
    memory: 256 * 1024 * 1024, // 256MB
    cpus: 0.5, // 50% of one CPU core
    pidsLimit: 50, // Max 50 processes
    timeout: 10000, // 10 seconds
  },

  // Security settings
  security: {
    networkMode: 'none' as const, // No network access
    readonlyRootfs: false, // Allow writing to /tmp
    user: 'executor', // Non-root user
    autoRemove: true, // Auto-cleanup after execution
    capDrop: ['ALL'], // Drop all capabilities
  },

  // Execution paths
  paths: {
    workingDir: '/tmp',
    codeFile: {
      python: '/tmp/solution.py',
      javascript: '/tmp/solution.js',
      cpp: '/tmp/solution.cpp',
      java: '/tmp/Solution.java',
    },
  },
} as const;

export type Language = keyof typeof DOCKER_CONFIG.images;
