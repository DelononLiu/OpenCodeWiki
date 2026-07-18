# QA Eval

API-driven QA quality test suite. Uses pytest + requests only — no backend module imports.

## Usage

./run.sh

## Structure

- test_qa.py — test cases from datasets/ and cases/
- conftest.py — backend fixture (start/stop)
- score.py — LLM-based scoring utility
- datasets/ — machine-annotated QA test data
- cases/ — human-annotated cases with reference answers
- results/ — test output
