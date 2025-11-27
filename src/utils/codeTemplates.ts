import { Language } from '../config/docker.js';

export function getStarterCode(
  functionName: string,
  language: Language,
  parameters: string[] = []
): string {
  const templates: Record<Language, (fn: string, params: string[]) => string> = {
    python: (fn, params) =>
      `def ${fn}(${params.join(', ')}):\n    # Write your code here\n    pass`,

    javascript: (fn, params) =>
      `function ${fn}(${params.join(', ')}) {\n    // Write your code here\n}`,

    cpp: (fn, params) => {
      const paramList = params.length > 0 ? params.join(', ') : '';
      return `#include <vector>\n#include <string>\nusing namespace std;\n\n// Adjust return type as needed\nauto ${fn}(${paramList}) {\n    // Write your code here\n}`;
    },

    java: (fn, params) => {
      const paramList = params.length > 0 ? params.join(', ') : '';
      return `class Solution {\n    // Adjust return type and parameter types as needed\n    public Object ${fn}(${paramList}) {\n        // Write your code here\n    }\n}`;
    },
  };

  return templates[language](functionName, parameters);
}

export function sanitizeCode(code: string): string {
  // Warn about potentially dangerous imports or system calls
  const dangerous = [
    'import os',
    'import sys',
    'import subprocess',
    'require("child_process")',
    'require("fs")',
    'require("net")',
    '#include <fstream>',
    '#include <filesystem>',
  ];

  for (const pattern of dangerous) {
    if (code.includes(pattern)) {
      console.warn(`Potentially dangerous code detected: ${pattern}`);
    }
  }

  return code;
}

export function validateCodeSize(code: string, maxSize: number = 10000): boolean {
  return code.length <= maxSize;
}
