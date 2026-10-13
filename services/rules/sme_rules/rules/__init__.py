"""Import để đăng ký rule vào default_registry. Rule mới: thêm file + một dòng import."""
from . import (  # noqa: F401
    r01_checklist,
    r02_tax_id,
    r03_name,
    r04_fs_basis,
    r05_fs_equation,
    r06_duplicate_invoice,
    r07_invoice_vs_contract,
    r08_acceptance_condition,
    r09_received_claim,
    r10_supplement_match,
)
