# Running Tests

Quick steps to run the project's tests reliably (Linux / macOS):

1. Activate the project's virtual environment (if you have one):

```bash
source .venv/bin/activate
```

2. Preferred: run pytest with the project Python and `src` on the import path (works even if `pytest` isn't on PATH):

```bash
PYTHONPATH=src .venv/bin/python -m pytest -q
```

3. Alternative: install dev dependencies and run `pytest` normally:

```bash
pip install -e ".[dev]"   # installs editable package + dev deps (pytest)
pytest -q
```

4. Run a single test file or test case:

```bash
# single file
PYTHONPATH=src .venv/bin/python -m pytest tests/test_tournament.py -q

# single test function
PYTHONPATH=src .venv/bin/python -m pytest tests/test_tournament.py::test_some_name -q
```

Notes & troubleshooting

- If you see `pytest: command not found`, either install pytest (`pip install pytest`) or use the `.venv/bin/python -m pytest` form shown above.
- The project uses `src` as the package source directory; `PYTHONPATH=src` ensures the tests import the local package instead of an installed version.
- If you prefer, install the package editable and run `pytest` from the activated venv after `pip install -e .`.
- VS Code: the included `.vscode/launch.json` sets `PYTHONPATH` for debugging. For running tests inside the editor, ensure the workspace interpreter is the project's venv.
- If database or config issues occur, check `configs/operational_config.json` and `chess_club.config` for `DB_PATH` and related runtime settings.

If you want, I can add a `Makefile` or a VS Code `tasks.json` entry so a single command runs the recommended invocation.
