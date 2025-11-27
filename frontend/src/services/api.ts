import axios from 'axios';
import { Problem, ProblemListItem } from '../types/problem';
import {
  ExecutionRequest,
  ExecutionResponse,
  IdeExecutionRequest,
  IdeExecutionResponse
} from '../types/execution';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
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
