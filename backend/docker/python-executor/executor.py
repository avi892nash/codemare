#!/usr/bin/env python3
import sys
import json
from io import StringIO
import contextlib

def execute_code(code, stdin_input):
    """Execute Python code with stdin/stdout redirection"""
    stdout_capture = StringIO()

    try:
        old_stdin = sys.stdin
        sys.stdin = StringIO(stdin_input)

        with contextlib.redirect_stdout(stdout_capture):
            exec(code, {'__name__': '__main__'})

        return {
            'output': stdout_capture.getvalue(),
            'error': None
        }

    except Exception as e:
        return {
            'output': stdout_capture.getvalue(),
            'error': f"{type(e).__name__}: {str(e)}"
        }
    finally:
        sys.stdin = old_stdin

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
