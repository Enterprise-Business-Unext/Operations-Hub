# Fix Deprecation Warnings in Backend Test Suite

## Goal
Eliminate two DeprecationWarnings emitted during the backend `pytest` run:
1. `passlib/utils/__init__.py:854: DeprecationWarning: 'crypt' is deprecated and slated for removal in Python 3.13`
2. `starlette/testclient.py:53: DeprecationWarning: The anyio.abc.BlockingPortal alias is deprecated, use anyio.from_thread.BlockingPortal instead.`

## Root cause
Both warnings originate from installed third-party packages, NOT project source code:
- `passlib==1.7.4` imports `from crypt import crypt as _crypt` at module load. `crypt` is deprecated since Python 3.11; the environment runs Python 3.11.17. passlib 1.7.4 is the final/unmaintained release, so there is no newer version to upgrade to.
- `starlette==1.3.1` uses the deprecated `anyio.abc.BlockingPortal` alias in `TestClient`; newer starlette uses `anyio.from_thread.BlockingPortal`.

Confirmed via grep: the project's own `backend/` code does not reference `crypt` or `anyio.abc.BlockingPortal`.

## Constraints
- Cannot run `pip`/`python`/`pytest` locally, so dependency upgrades cannot be installed or verified here.
- `fastapi==0.143.3` currently coexists with `starlette==1.3.1` and tests pass (47/47), so FastAPI accepts starlette 1.x, but the exact upgrade-compatible starlette version is unverified.
- `backend/requirements.txt` pins `starlette==1.3.1`, `passlib[bcrypt]==1.7.4`, `anyio==4.15.1`.

## Changes
1. Create `backend/pytest.ini` with a `[pytest]` section and `filterwarnings` to suppress the two third-party DeprecationWarnings during test runs:
   ```
   [pytest]
   filterwarnings =
       ignore:.*crypt.*deprecated.*:DeprecationWarning:passlib
       ignore:.*BlockingPortal alias is deprecated.*:DeprecationWarning:starlette.testclient
   ```
2. Do NOT edit `requirements.txt` (no locally-verifiable upgrade path; starlette upgrade deferred — see follow-up).

## Follow-up (out of scope for this plan)
- Upgrade `starlette` to a version using `anyio.from_thread.BlockingPortal` once FastAPI 0.143.3 compatibility is confirmed in CI.
- `passlib` cannot be upgraded (1.7.4 is final); the pytest suppression is the long-term handling unless passlib is replaced.

## Validation
- Run `python -m pytest -q` from `backend/` and confirm:
  - the two DeprecationWarnings no longer appear in the warnings summary,
  - all 47 backend tests still pass.
