#!/usr/bin/env python3
import sys
import json
import subprocess
import time
import os

def run_tests(code, test_cases, function_name):
    """
    Compile and execute C++ code and run all test cases
    """
    results = []

    # Create a test runner that wraps user code
    # Using triple quotes and string formatting separately to avoid escaping issues
    cpp_template = """
#include <iostream>
#include <vector>
#include <string>
#include <sstream>
#include <algorithm>
using namespace std;

USER_CODE_HERE

// Helper to parse vector from string like "[1,2,3]"
vector<int> parseVector(const string& s) {
    vector<int> result;
    if (s.empty() || s == "[]") return result;

    string cleaned = s;
    // Remove brackets
    cleaned.erase(remove(cleaned.begin(), cleaned.end(), '['), cleaned.end());
    cleaned.erase(remove(cleaned.begin(), cleaned.end(), ']'), cleaned.end());

    stringstream ss(cleaned);
    string item;
    while (getline(ss, item, ',')) {
        if (!item.empty()) {
            result.push_back(stoi(item));
        }
    }
    return result;
}

// Helper to output vector as JSON array
void printVector(const vector<int>& v) {
    cout << "[";
    for (size_t i = 0; i < v.size(); i++) {
        cout << v[i];
        if (i < v.size() - 1) cout << ",";
    }
    cout << "]";
}

int main() {
    string line;
    while (getline(cin, line)) {
        if (line.empty()) continue;

        stringstream ss(line);
        string numsStr, targetStr;

        // Read nums and target (separated by |)
        getline(ss, numsStr, '|');
        getline(ss, targetStr, '|');

        try {
            vector<int> nums = parseVector(numsStr);
            int target = stoi(targetStr);

            vector<int> result = FUNCTION_NAME_HERE(nums, target);

            printVector(result);
            cout << endl;
        } catch (const exception& e) {
            cout << "ERROR:" << e.what() << endl;
        }
    }

    return 0;
}
"""

    test_runner_code = cpp_template.replace('USER_CODE_HERE', code).replace('FUNCTION_NAME_HERE', function_name)

    cpp_file = '/tmp/solution.cpp'
    exe_file = '/tmp/solution'

    try:
        # Write the complete test runner
        with open(cpp_file, 'w') as f:
            f.write(test_runner_code)

        # Compile the C++ code
        compile_result = subprocess.run(
            ['g++', '-std=c++17', '-O2', cpp_file, '-o', exe_file],
            capture_output=True,
            text=True,
            timeout=10
        )

        if compile_result.returncode != 0:
            return {
                "error": f"Compilation Error: {compile_result.stderr}"
            }

        # Run tests
        for test in test_cases:
            start_time = time.time()
            try:
                # Format input for C++ program
                # For twoSum: input is [[nums], target]
                if len(test['input']) >= 2:
                    nums = test['input'][0]
                    target = test['input'][1]
                    input_str = f"{json.dumps(nums)}|{target}\n"
                else:
                    input_str = "[]|0\n"

                # Run the compiled program
                run_result = subprocess.run(
                    [exe_file],
                    input=input_str,
                    capture_output=True,
                    text=True,
                    timeout=5
                )

                execution_time = (time.time() - start_time) * 1000

                if run_result.returncode != 0:
                    results.append({
                        "output": None,
                        "expected": test['expected'],
                        "passed": False,
                        "error": f"Runtime Error: {run_result.stderr}",
                        "executionTime": execution_time
                    })
                    continue

                # Parse output
                output = run_result.stdout.strip()

                if output.startswith("ERROR:"):
                    results.append({
                        "output": None,
                        "expected": test['expected'],
                        "passed": False,
                        "error": output[6:],
                        "executionTime": execution_time
                    })
                    continue

                # Parse the result
                try:
                    result = json.loads(output)
                except:
                    result = output

                results.append({
                    "output": result,
                    "expected": test['expected'],
                    "passed": result == test['expected'],
                    "executionTime": execution_time
                })

            except subprocess.TimeoutExpired:
                execution_time = (time.time() - start_time) * 1000
                results.append({
                    "output": None,
                    "expected": test['expected'],
                    "passed": False,
                    "error": "Time Limit Exceeded",
                    "executionTime": execution_time
                })
            except Exception as e:
                execution_time = (time.time() - start_time) * 1000
                results.append({
                    "output": None,
                    "expected": test['expected'],
                    "passed": False,
                    "error": f"{type(e).__name__}: {str(e)}",
                    "executionTime": execution_time
                })

        return {"results": results}

    except Exception as e:
        return {
            "error": f"Execution Error: {str(e)}"
        }
    finally:
        # Cleanup
        for f in [cpp_file, exe_file]:
            if os.path.exists(f):
                os.remove(f)

if __name__ == "__main__":
    try:
        # Read test data from stdin
        input_data = sys.stdin.read()
        data = json.loads(input_data)

        # Run tests
        output = run_tests(
            data['code'],
            data['tests'],
            data['functionName']
        )

        # Output results as JSON
        print(json.dumps(output))
    except Exception as e:
        print(json.dumps({
            "error": f"Unexpected error: {str(e)}"
        }))
