#!/usr/bin/env python3
import sys
import json
import subprocess
import re

def execute_code(code, stdin_input):
    """Compile and execute Java code with stdin"""

    # Detect class name
    match = re.search(r'public\s+class\s+(\w+)', code)
    class_name = match.group(1) if match else 'Main'

    # Write code to file
    with open(f'/tmp/{class_name}.java', 'w') as f:
        f.write(code)

    # Compile
    compile_result = subprocess.run(
        ['javac', f'/tmp/{class_name}.java'],
        capture_output=True,
        text=True,
        timeout=10
    )

    if compile_result.returncode != 0:
        return {
            'output': '',
            'error': f"Compilation error: {compile_result.stderr}"
        }

    # Execute
    try:
        run_result = subprocess.run(
            ['java', '-cp', '/tmp', class_name],
            input=stdin_input,
            capture_output=True,
            text=True,
            timeout=5
        )

        return {
            'output': run_result.stdout,
            'error': run_result.stderr if run_result.returncode != 0 else None
        }

    except subprocess.TimeoutExpired:
        return {'output': '', 'error': 'Execution timeout (5s)'}
    except Exception as e:
        return {'output': '', 'error': str(e)}

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        data = json.loads(input_data)

        result = execute_code(data['code'], data['input'])
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({
            'output': '',
            'error': f"Executor error: {str(e)}"
        }))
