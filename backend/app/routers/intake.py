"""Document intake — parse a brief/quote image into structured job-spec fields.

Stateless (no spec needed): the wizard calls this early and applies the returned fields
to its own state, then persists them when it creates the event. Both the document path
and the voice path write the same structured spec.
"""
from fastapi import APIRouter, Depends, File, UploadFile

from ..auth import current_user
from ..models import User
from ..services import document_intake

router = APIRouter(prefix="/api/intake", tags=["intake"])


@router.post("/parse-document")
async def parse_document(file: UploadFile = File(...), user: User = Depends(current_user)) -> dict:
    data = await file.read()
    return document_intake.recognize(data)
