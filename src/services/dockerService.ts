import Docker from 'dockerode';
import { spawn } from 'child_process';
import {
  Language,
  DockerExecutionInput,
  DockerExecutionOutput,
} from '../models/ExecutionResult.js';
import { DOCKER_CONFIG } from '../config/docker.js';

/**
 * Execute a command and return stdout/stderr with support for stdin input
 */
function execAsync(
  command: string,
  options: { input?: string; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(' ');
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const maxBuffer = options.maxBuffer || 1024 * 1024;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > maxBuffer) {
        child.kill();
        reject(new Error('stdout maxBuffer exceeded'));
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > maxBuffer) {
        child.kill();
        reject(new Error('stderr maxBuffer exceeded'));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
      }
    });

    // Send input to stdin if provided
    if (options.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}

const docker = new Docker();

// Use centralized Docker configuration
const LANGUAGE_IMAGES = DOCKER_CONFIG.images;

export interface ExecutionConfig {
  memory: number; // in bytes
  cpus: number; // fractional CPUs
  timeout: number; // in milliseconds
  pidsLimit: number;
}

const DEFAULT_CONFIG: ExecutionConfig = DOCKER_CONFIG.limits;

/**
 * Execute code in a sandboxed Docker container
 */
export async function executeInDocker(
  language: Language,
  input: DockerExecutionInput,
  config: ExecutionConfig = DEFAULT_CONFIG
): Promise<DockerExecutionOutput> {
  const imageName = LANGUAGE_IMAGES[language];

  if (!imageName) {
    throw new Error(`Unsupported language: ${language}`);
  }

  try {
    // Prepare input data
    const inputData = JSON.stringify(input);

    // Build docker run command
    const dockerCmd = [
      'docker',
      'run',
      '--rm',
      '-i',
      `--memory=${config.memory}`,
      `--cpus=${config.cpus}`,
      `--pids-limit=${config.pidsLimit}`,
      '--network=none',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user=executor',
      imageName,
    ].join(' ');

    // Execute with timeout
    const timeoutMs = config.timeout;
    const { stdout, stderr } = await Promise.race([
      execAsync(dockerCmd, {
        input: inputData,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Execution timeout exceeded')),
          timeoutMs
        )
      ),
    ]);

    const output = stdout.trim();

    // Parse output
    try {
      const parsedOutput: DockerExecutionOutput = JSON.parse(output);
      return parsedOutput;
    } catch (parseError) {
      // If JSON parsing fails, return raw output as error
      return {
        error: `Failed to parse executor output: ${output || stderr}`,
      };
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return {
          error: 'Time Limit Exceeded',
        };
      }
      return {
        error: `Execution failed: ${error.message}`,
      };
    }
    return {
      error: 'Unknown execution error',
    };
  }
}

/**
 * Check if required Docker images are available
 */
export async function checkDockerImages(): Promise<{
  available: Language[];
  missing: Language[];
}> {
  const available: Language[] = [];
  const missing: Language[] = [];

  for (const [lang, imageName] of Object.entries(LANGUAGE_IMAGES)) {
    try {
      await docker.getImage(imageName).inspect();
      available.push(lang as Language);
    } catch {
      missing.push(lang as Language);
    }
  }

  return { available, missing };
}

/**
 * Get Docker stats (for monitoring)
 */
export async function getDockerStats(): Promise<{
  containers: number;
  images: number;
}> {
  const containers = await docker.listContainers({ all: true });
  const images = await docker.listImages();

  return {
    containers: containers.length,
    images: images.length,
  };
}
