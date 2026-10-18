"""Explicit UTF-8 metadata for JSON clients, including Windows PowerShell 5.1."""
from fastapi.responses import JSONResponse


class UTF8JSONResponse(JSONResponse):
    # Starlette already serializes UTF-8. Legacy clients need the charset header.
    media_type = "application/json; charset=utf-8"
