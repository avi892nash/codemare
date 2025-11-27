import { Language } from '../types/execution';

export const IDE_TEMPLATES: Record<Language, string> = {
  python: `# Python Template - Read from stdin and write to stdout

# Example: Read two numbers and print their sum
a = int(input())
b = int(input())
result = a + b
print(result)
`,

  javascript: `// JavaScript Template - Read from stdin and write to stdout

// Example: Read two numbers and print their sum
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const lines = [];

rl.on('line', (line) => {
  lines.push(line);
});

rl.on('close', () => {
  const a = parseInt(lines[0]);
  const b = parseInt(lines[1]);
  const result = a + b;
  console.log(result);
});
`,

  cpp: `// C++ Template - Read from stdin and write to stdout

#include <iostream>
using namespace std;

int main() {
    // Example: Read two numbers and print their sum
    int a, b;
    cin >> a >> b;
    int result = a + b;
    cout << result << endl;

    return 0;
}
`,

  java: `// Java Template - Read from stdin and write to stdout

import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        // Example: Read two numbers and print their sum
        Scanner scanner = new Scanner(System.in);

        int a = scanner.nextInt();
        int b = scanner.nextInt();
        int result = a + b;

        System.out.println(result);

        scanner.close();
    }
}
`
};
