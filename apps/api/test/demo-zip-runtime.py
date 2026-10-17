"""Explicit offline HTTP test backend; real PDF engine and grounding, synthetic proposer.

Reports mode=mock. No cloud/network client, dotenv or gold-fixture success fallback.
"""
import base64
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services/ai"))
import pymupdf


def fixtures():
    def pdf(text, count=1):
        doc = pymupdf.open()
        for n in range(count):
            doc.new_page().insert_text((40, 60), text + f" Page {n + 1}")
        data = doc.tobytes()
        doc.close()
        return data
    def zip_bytes(entries):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as z:
            for name, content in entries:
                z.writestr(name, content)
        return stream.getvalue()
    members = [("BCTC_2025.pdf", pdf("Total assets: 1000000 VND. Period end: 2025-12-31.")),
               ("contract.pdf", pdf("Contract ref: DEMO-001. Contract amount: 1250000 VND.")),
               ("TK_thue_01.pdf", pdf("Tax declaration - SYNTHETIC - no business records.")),
               ("payment.pdf", pdf("Payment ref: PAY-001. Payment amount: 1250000 VND."))]
    output = {"zip": zip_bytes(members + [("book.xlsx", b"UNSUPPORTED SYNTHETIC"),
                                           ("eleven-pages.pdf", pdf("Synthetic over page limit", 11))]),
              "safe": zip_bytes(members), "unsafe": zip_bytes(members + [("../evil.pdf", members[0][1])]),
              "pages": zip_bytes([(f"eight-pages-{n}.pdf", pdf("Synthetic page cap", 8)) for n in range(6)]),
              "rejected": zip_bytes([("nested.zip", b"PK\x03\x04"), ("broken.pdf", b"%PDF-1.7\ninvalid")]),
              "pdf": members[1][1]}
    print(json.dumps({key: base64.b64encode(value).decode("ascii") for key, value in output.items()}))


def serve():
    import os
    import socket
    import uvicorn
    import runner.config
    runner.config.load_dotenv = lambda *a, **kw: []
    # Refuse external connections even if a future edit introduces a provider client.
    socketpair_code = getattr(getattr(socket, "_fallback_socketpair", None), "__code__", None)
    def guard(event, args):
        if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)) and Path(os.fsdecode(args[0])).name == ".env":
            raise RuntimeError("No dotenv in offline runtime")
        if event == "socket.connect" and not (socketpair_code and sys._getframe(1).f_code is socketpair_code):
            raise RuntimeError("No outbound connections in offline runtime")
    sys.addaudithook(guard)
    from extraction import Config, Service
    from extraction.extractor import Extractor
    from runner.app import create_app
    from runner.config import Settings
    from runner.contracts import Contracts
    contracts = Contracts(ROOT / "packages/contracts")
    class Proposer:
        model_id = "SYNTHETIC-OFFLINE-NOT-LIVE-MODEL"
        def generate_json(self, system, user, schema, **kwargs):
            doc_type = user.splitlines()[0].split(": ", 1)[1]
            keys = schema["properties"]["fields"]["items"]["properties"]["field_key"]["enum"]
            fields = []
            for key in keys:
                value, quote = {"contract.ref": ("DEMO-001", "Contract ref: DEMO-001."),
                                "payment.ref": ("PAY-001", "Payment ref: PAY-001.")}.get(key, (None, None))
                # Additional, explicitly synthetic dossier oracle. Keep the
                # existing four-PDF fixtures unchanged; guards still decide
                # whether these literal proposals match the actual source.
                if key == "contract.ref" and "Contract ref: DEMO001." in user:
                    value, quote = "DEMO001", "Contract ref: DEMO001."
                if key == "payment.ref" and "Payment ref: DEMOPAY001." in user:
                    value, quote = "DEMOPAY001", "Payment ref: DEMOPAY001."
                fields.append({"field_key": key, "status": "found" if value else "not_present",
                    "value": value, "payment_condition": None,
                    "evidence": [{"page": 1, "quote": quote}] if quote else []})
            return SimpleNamespace(data={"detected_type": doc_type, "classification_confident": False, "fields": fields})
    service = Service(Config(storage_dir=Path(sys.argv[3])), lambda: Extractor(contracts, Proposer(), None))
    class Backend:
        name = "live" if sys.argv[1] == "inspect-only" else "mock"
        def inspect(self, payload): return service.inspect(payload)
        def extract(self, payload):
            if self.name == "live":
                from runner.errors import ServiceError
                raise ServiceError(503, "PROVIDER_UNAVAILABLE", "Offline native inspection harness has no model provider.")
            return service.extract(payload)
    settings = Settings.from_env({"AI_MODE": Backend.name, "INTERNAL_API_KEY": os.environ["INTERNAL_API_KEY"]})
    uvicorn.run(create_app(settings, Backend(), contracts), host="127.0.0.1", port=int(sys.argv[2]),
                log_level="error", access_log=False)


if __name__ == "__main__":
    fixtures() if sys.argv[1] == "fixtures" else serve()
