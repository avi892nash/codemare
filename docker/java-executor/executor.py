#!/usr/bin/env python3
import sys
import json
import subprocess
import time
import os

def run_tests(code, test_cases, function_name):
    """
    Compile and execute Java code and run all test cases
    """
    results = []

    # Create a Java class with main method that tests the user's function
    # For simplicity, we'll create a wrapper class
    java_template = '''
import java.util.*;
import com.google.gson.*;

{user_code}

public class Solution {{
    public static void main(String[] args) {{
        Gson gson = new Gson();
        Scanner scanner = new Scanner(System.in);
        String testDataJson = scanner.nextLine();

        JsonArray testCases = JsonParser.parseString(testDataJson).getAsJsonArray();
        JsonArray results = new JsonArray();

        Solution solution = new Solution();

        for (JsonElement testCaseElement : testCases) {{
            JsonObject testCase = testCaseElement.getAsJsonObject();
            JsonArray inputs = testCase.getAsJsonArray("input");

            try {{
                // This is simplified - would need proper type handling for production
                long startTime = System.nanoTime();

                // Call user function - this needs to be generated based on signature
                // For MVP, we'll use a simplified approach

                long endTime = System.nanoTime();
                double executionTime = (endTime - startTime) / 1000000.0;

                JsonObject result = new JsonObject();
                result.addProperty("executionTime", executionTime);
                results.add(result);
            }} catch (Exception e) {{
                JsonObject result = new JsonObject();
                result.addProperty("error", e.getMessage());
                result.addProperty("passed", false);
                results.add(result);
            }}
        }}

        System.out.println(gson.toJson(results));
    }}
}}
'''

    # Write Java code to file
    java_file = '/tmp/Solution.java'
    class_file = '/tmp/Solution.class'

    try:
        with open(java_file, 'w') as f:
            f.write(code)

        # Compile the Java code
        compile_result = subprocess.run(
            ['javac', java_file],
            capture_output=True,
            text=True,
            timeout=10,
            cwd='/tmp'
        )

        if compile_result.returncode != 0:
            return {
                "error": f"Compilation Error: {compile_result.stderr}"
            }

        # Run each test case
        for test in test_cases:
            start_time = time.time()
            try:
                # Create test input
                test_input = json.dumps([{
                    "input": test['input'],
                    "expected": test['expected']
                }])

                # Run the compiled program
                run_result = subprocess.run(
                    ['java', '-cp', '/tmp', 'Solution'],
                    input=test_input,
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

                # For MVP, simplified output parsing
                # Production would need proper result parsing
                try:
                    output = run_result.stdout.strip()
                    result_data = json.loads(output)[0] if output else {}

                    results.append({
                        "output": result_data.get('output'),
                        "expected": test['expected'],
                        "passed": result_data.get('passed', False),
                        "executionTime": result_data.get('executionTime', execution_time),
                        "error": result_data.get('error')
                    })
                except:
                    results.append({
                        "output": run_result.stdout.strip(),
                        "expected": test['expected'],
                        "passed": False,
                        "error": "Failed to parse output",
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
        for pattern in ['Solution*.java', 'Solution*.class']:
            subprocess.run(['rm', '-f', f'/tmp/{pattern}'], capture_output=True)

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
