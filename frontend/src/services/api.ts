import axios from 'axios';
import { Problem, ProblemListItem } from '../types/problem';
import {
  ExecutionRequest,
  ExecutionResponse,
  IdeExecutionRequest,
  IdeExecutionResponse
} from '../types/execution';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Internal-auth token for the compile service. The legacy Vite frontend
 * carries this so dev keeps working; once the Next.js backend is in place,
 * the browser will never see this token — it'll be a server-only env var
 * attached to API calls inside Next.js server actions / route handlers.
 *
 * Leave VITE_INTERNAL_TOKEN unset in dev when the backend itself has no
 * INTERNAL_TOKEN configured (dev-open mode).
 */
const INTERNAL_TOKEN = import.meta.env.VITE_INTERNAL_TOKEN as string | undefined;

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
};
if (INTERNAL_TOKEN) {
  headers['X-Codemare-Token'] = INTERNAL_TOKEN;
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers,
  timeout: 30000, // 30 second timeout
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const problemsApi = {
  // Get all problems
  getAll: async (): Promise<ProblemListItem[]> => {
    const response = await apiClient.get('/api/problems');
    return response.data.problems;
  },

  // Get specific problem
  getById: async (id: string): Promise<Problem> => {
    const response = await apiClient.get(`/api/problems/${id}`);
    return response.data.problem;
  },
};

export const executionApi = {
  // Execute code
  execute: async (request: ExecutionRequest): Promise<ExecutionResponse> => {
    const response = await apiClient.post('/api/execute', request);
    return response.data;
  },
};

export const ideExecutionApi = {
  // Execute IDE code with custom test cases
  execute: async (request: IdeExecutionRequest): Promise<IdeExecutionResponse> => {
    const response = await apiClient.post('/api/ide/execute', request);
    return response.data;
  },
};
