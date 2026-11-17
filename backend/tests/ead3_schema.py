"""Validate EAD3 documents against the vendored official schema (EAD3 1.1.1)."""
import pathlib

from lxml import etree

_SCHEMA_PATH = pathlib.Path(__file__).resolve().parents[1] / "app" / "services" / "schemas" / "ead3" / "ead3.rng"
_SCHEMA = etree.RelaxNG(etree.parse(str(_SCHEMA_PATH)))


def assert_valid_ead3(xml: bytes) -> None:
    doc = etree.fromstring(xml)
    if not _SCHEMA.validate(doc):
        errors = "\n".join(f"line {e.line}: {e.message}" for e in _SCHEMA.error_log)
        raise AssertionError(f"EAD3 export is not valid against the official schema:\n{errors}\n\n{xml.decode()[:3000]}")
