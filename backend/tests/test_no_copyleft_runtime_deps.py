"""
Madrona ships under a permissive license, so the default install must not
pull in a copyleft runtime dependency.

PyMuPDF (`fitz`) was the live problem: AGPL-3.0 unless you hold an Artifex
commercial license. AGPL §13 covers network use, so every operator of a
combined work — self-hosters included — would owe complete corresponding
source for the whole application. It was in requirements.txt and imported by
three services, so it shipped in the default image.

mutagen is GPL-2.0-or-later. No §13, so the exposure is narrower — only
distributing a combined work — but bundling it in the image is exactly that.
It moved to requirements-copyleft.txt and stays behind MUTAGEN_AVAILABLE.
"""

from __future__ import annotations

import pathlib
import re

_ROOT = pathlib.Path(__file__).resolve().parent.parent

# Distribution name -> why it cannot be a default dependency.
_FORBIDDEN = {
    "pymupdf": "AGPL-3.0 without an Artifex commercial license",
    "fitz": "AGPL-3.0 (PyMuPDF import name)",
    "mutagen": "GPL-2.0-or-later — belongs in requirements-copyleft.txt",
    # GPLv2 with Oracle's FOSS License Exception. The exception is probably
    # satisfied, but "probably" turns on reading Oracle's current approved
    # license schedule; PyMySQL is MIT and settles it.
    "mysql-connector-python": "GPL-2.0 with a conditional exception — use pymysql",
}


def _default_requirements() -> list[str]:
    text = (_ROOT / "requirements.txt").read_text()
    out = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            out.append(re.split(r"[<>=!\[;]", line, 1)[0].strip().lower())
    return out


class TestDefaultInstallStaysPermissive:
    def test_no_copyleft_package_in_requirements(self):
        offenders = [
            f"{name} ({_FORBIDDEN[name]})"
            for name in _default_requirements()
            if name in _FORBIDDEN
        ]
        assert offenders == [], (
            "copyleft dependencies in the default install:\n  "
            + "\n  ".join(offenders)
        )

    def test_pypdfium2_is_the_declared_pdf_engine(self):
        assert "pypdfium2" in _default_requirements()

    def test_pymysql_is_the_declared_mysql_driver(self):
        assert "pymysql" in _default_requirements()

    def test_copyleft_extras_file_exists_and_is_not_installed_by_default(self):
        extras = _ROOT / "requirements-copyleft.txt"
        assert extras.exists(), "requirements-copyleft.txt is missing"
        assert "mutagen" in extras.read_text()

        dockerfile = (_ROOT / "Dockerfile").read_text()
        assert "requirements-copyleft.txt" not in dockerfile, (
            "the image must not install copyleft extras"
        )


class TestNoSourceFileImportsPyMuPDF:
    def test_fitz_is_not_imported_anywhere(self):
        hits = []
        for path in sorted((_ROOT / "app").rglob("*.py")):
            for i, line in enumerate(path.read_text().splitlines(), 1):
                stripped = line.strip()
                if re.match(r"^(import fitz|from fitz\b)", stripped) or \
                   re.match(r"^(import pymupdf|from pymupdf\b)", stripped):
                    hits.append(f"{path.relative_to(_ROOT)}:{i}")
        assert hits == [], "PyMuPDF is imported at:\n  " + "\n  ".join(hits)
