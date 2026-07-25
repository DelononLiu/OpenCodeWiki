import asyncio
import os
import tempfile
import pytest

from backend.sync.svn_sync import (
    is_auth_error, SVNAuthError, _build_svn_url,
    _build_auth_args, list_files,
)


class TestSVNSyncUtils:

    def test_is_auth_error_detects_e215004(self):
        assert is_auth_error("svn: E215004: authentication error")

    def test_is_auth_error_detects_e170001(self):
        assert is_auth_error("svn: E170001: authentication required")

    def test_is_auth_error_returns_false_for_other_errors(self):
        assert not is_auth_error("svn: E000001: file not found")
        assert not is_auth_error("")

    def test_build_svn_url_appends_trunk(self):
        assert _build_svn_url("svn://example.com/repo", "trunk") == "svn://example.com/repo/trunk"

    def test_build_svn_url_does_not_duplicate_branch(self):
        assert _build_svn_url("svn://example.com/repo/trunk", "trunk") == "svn://example.com/repo/trunk"

    def test_build_svn_url_handles_empty_branch(self):
        assert _build_svn_url("svn://example.com/repo", "") == "svn://example.com/repo"

    def test_build_svn_url_handles_branches_path(self):
        assert _build_svn_url("svn://example.com/repo", "branches/feature") == "svn://example.com/repo/branches/feature"

    def test_build_auth_args_no_creds(self):
        args = _build_auth_args(None, None)
        assert "--username" not in args
        assert "--password" not in args

    def test_build_auth_args_with_creds(self):
        args = _build_auth_args("alice", "secret")
        assert "--username" in args
        assert "--password" in args
        assert args[args.index("--username") + 1] == "alice"
        assert args[args.index("--password") + 1] == "secret"

    def test_list_files_skips_svn_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Create a file in the repo root
            with open(os.path.join(tmp, "readme.md"), "w") as f:
                f.write("# Hello")
            # Create a .svn directory (simulated)
            svn_dir = os.path.join(tmp, ".svn")
            os.makedirs(svn_dir)
            with open(os.path.join(svn_dir, "entries"), "w") as f:
                f.write("dummy")

            files = asyncio.run(list_files(tmp))
            assert "readme.md" in files
            assert ".svn/entries" not in files


class TestSVNAuthError:

    def test_svn_auth_error_inherits_runtime_error(self):
        assert issubclass(SVNAuthError, RuntimeError)
