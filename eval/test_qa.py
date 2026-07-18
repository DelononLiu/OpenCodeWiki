"""QA quality evaluation tests — pure API-driven, no backend module dependency.

Uses datasets/ (machine-annotated) and cases/ (human-annotated with reference answers).
"""
import json
import os
import requests
import pytest

HERE = os.path.dirname(__file__)
DATASETS_DIR = os.path.join(HERE, "datasets")
CASES_DIR = os.path.join(HERE, "cases")
RESULTS_DIR = os.path.join(HERE, "results")


def load_json(path):
    with open(path) as f:
        return json.load(f)


def stream_qa(api, question, repo=""):
    """Call POST /api/qa (SSE) and collect the full answer."""
    resp = api.post("/api/qa", json={"question": question, "repo": repo}, stream=True)
    assert resp.status_code == 200, f"QA API returned {resp.status_code}"

    answer_parts = []
    for line in resp.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            try:
                data = json.loads(line[6:])
                if data.get("type") == "token":
                    answer_parts.append(data.get("content", ""))
                elif data.get("type") == "error":
                    return f"ERROR: {data.get('message')}"
            except json.JSONDecodeError:
                pass
    return "".join(answer_parts)


# ── Dataset-driven tests ──

def _load_dataset(filename):
    path = os.path.join(DATASETS_DIR, filename)
    return load_json(path) if os.path.exists(path) else []


def dataset_cases():
    """Collect all test cases from datasets."""
    cases = []
    for f in os.listdir(DATASETS_DIR):
        if f.endswith(".json"):
            for item in load_json(os.path.join(DATASETS_DIR, f)):
                cases.append(pytest.param(item, id=item.get("id", f)))
    return cases


@pytest.mark.slow
@pytest.mark.parametrize("item", dataset_cases())
def test_qa_answer_not_empty(api, item):
    """Every dataset question should produce a non-empty answer."""
    answer = stream_qa(api, item["question"], item.get("repo", ""))
    assert len(answer.strip()) > 10, f"Answer too short for {item['id']}: {answer[:100]}"


# ── Human-annotated case tests ──

def human_cases():
    """Collect all cases with reference answers."""
    cases = []
    for f in sorted(os.listdir(CASES_DIR)):
        if f.endswith(".json"):
            item = load_json(os.path.join(CASES_DIR, f))
            if item.get("reference"):
                cases.append(pytest.param(item, id=item.get("id", f)))
    return cases


@pytest.mark.slow
@pytest.mark.parametrize("item", human_cases())
def test_qa_with_reference(api, item):
    """Cases with reference answers — save result for scoring."""
    answer = stream_qa(api, item["question"], item.get("repo", ""))
    assert len(answer.strip()) > 50, f"Answer too short for {item['id']}"

    # Save result
    os.makedirs(RESULTS_DIR, exist_ok=True)
    result = {
        "id": item["id"],
        "question": item["question"],
        "answer": answer,
        "reference": item.get("reference", ""),
    }
    out_path = os.path.join(RESULTS_DIR, f"{item['id']}.json")
    with open(out_path, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


# ── API smoke tests (fast) ──

def test_api_repos(api):
    resp = api.get("/api/repos")
    assert resp.status_code == 200
    assert resp.json()["ok"]


def test_api_search(api):
    resp = api.get("/api/search?q=test")
    assert resp.status_code == 200
    assert resp.json()["ok"]


def test_api_qa_entries(api):
    resp = api.get("/api/qa/entries")
    assert resp.status_code == 200
    assert resp.json()["ok"]
