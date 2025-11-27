#!/usr/bin/env python3
import sys
import json
import traceback
import time
from io import StringIO

def run_tests(code, test_cases, function_name):
    """
    Execute user code and run all test cases
    """
    results = []
    exec_globals = {}

    # Execute user code in isolated namespace
    try:
        exec(code, exec_globals)
    except SyntaxError as e:
        return {
            "error": f"Syntax Error: {str(e)}",
            "traceback": traceback.format_exc()
        }
    except Exception as e:
        return {
            "error": f"Execution Error: {str(e)}",
            "traceback": traceback.format_exc()
        }

    # Get user's function
    user_function = exec_globals.get(function_name)
    if not user_function:
        return {
            "error": f"Function '{function_name}' not found in your code"
        }

    if not callable(user_function):
        return {
            "error": f"'{function_name}' is not a function"
        }

    # Run each test case
    for test in test_cases:
        start_time = time.time()
        try:
            # Call user function with test inputs
            result = user_function(*test['input'])
            execution_time = (time.time() - start_time) * 1000  # Convert to ms

            results.append({
                "output": result,
                "expected": test['expected'],
                "passed": result == test['expected'],
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
    except json.JSONDecodeError as e:
        print(json.dumps({
            "error": f"Invalid JSON input: {str(e)}"
        }))
    except KeyError as e:
        print(json.dumps({
            "error": f"Missing required field: {str(e)}"
        }))
    except Exception as e:
        print(json.dumps({
            "error": f"Unexpected error: {str(e)}",
            "traceback": traceback.format_exc()
        }))
