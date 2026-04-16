from contextlib import asynccontextmanager
from typing import Annotated, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.requests import Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

import database as db
import llm
import nlp_engine

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    nlp_engine.load_model()
    yield


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

SessionDep = Annotated[Session, Depends(db.get_session)]


# --------------- Pages ---------------

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


# --------------- Schemas ---------------

class AnalyzeRequest(BaseModel):
    text: str

class WordRequest(BaseModel):
    word: str
    lemma: Optional[str] = None

class LearnWordRequest(BaseModel):
    word: str
    lemma: Optional[str] = None
    context: Optional[str] = None

class BulkWordsRequest(BaseModel):
    words: list[str]

class TranslateRequest(BaseModel):
    word: str
    context: str


# --------------- Analyze API ---------------

@app.post("/api/analyze")
def analyze(body: AnalyzeRequest, session: SessionDep):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    known_lemmas = db.get_known_lemmas(session)
    known_words = db.get_known_words_set(session)
    return nlp_engine.analyze_text(text, known_lemmas, known_words)


# --------------- Translate API ---------------

@app.post("/api/translate")
def translate(body: TranslateRequest):
    word = body.word.strip()
    context = body.context.strip()
    if not word or not context:
        raise HTTPException(status_code=400, detail="word and context are required")
    try:
        result = llm.translate_word_in_context(word, context)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


# --------------- Known Words API ---------------

@app.get("/api/known-words")
def list_known(session: SessionDep):
    rows = db.get_all_known_words(session)
    return [{"id": r.id, "word": r.word, "lemma": r.lemma, "created_at": r.created_at} for r in rows]


@app.post("/api/known-words", status_code=201)
def add_known(body: WordRequest, session: SessionDep):
    word = body.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="Word is required")
    lemma = body.lemma or nlp_engine.lemmatize(word)
    db.add_known_word(session, word, lemma)
    return {"status": "added", "word": word, "lemma": lemma}


@app.post("/api/known-words/bulk", status_code=201)
def add_known_bulk(body: BulkWordsRequest, session: SessionDep):
    if not body.words:
        raise HTTPException(status_code=400, detail="No words provided")

    added = 0
    skipped = 0
    for w in body.words:
        w = w.strip()
        if not w:
            continue
        lemma = nlp_engine.lemmatize(w)
        if db.add_known_word(session, w, lemma):
            added += 1
        else:
            skipped += 1
    return {"added": added, "skipped": skipped}


@app.put("/api/known-words/{word_id}")
def update_known(word_id: int, body: WordRequest, session: SessionDep):
    word = body.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="Word is required")
    lemma = body.lemma or nlp_engine.lemmatize(word)
    if db.update_known_word(session, word_id, word, lemma):
        return {"status": "updated"}
    raise HTTPException(status_code=404, detail="Not found or duplicate")


@app.delete("/api/known-words/{word_id}")
def delete_known(word_id: int, session: SessionDep):
    if db.delete_known_word(session, word_id):
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Not found")


# --------------- Learn Words API ---------------

@app.get("/api/learn-words")
def list_learn(session: SessionDep):
    rows = db.get_all_learn_words(session)
    return [
        {"id": r.id, "word": r.word, "lemma": r.lemma, "context": r.context, "created_at": r.created_at}
        for r in rows
    ]


@app.get("/api/learn-words/download")
def download_learn(session: SessionDep):
    import csv, io
    rows = db.get_all_learn_words(session)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["word", "lemma", "context", "created_at"])
    for r in rows:
        writer.writerow([r.word, r.lemma, r.context or "", r.created_at])
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=unknown_words.csv"},
    )


@app.post("/api/learn-words", status_code=201)
def add_learn(body: LearnWordRequest, session: SessionDep):
    word = body.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="Word is required")
    lemma = body.lemma or nlp_engine.lemmatize(word)
    if db.add_learn_word(session, word, lemma, body.context):
        return {"status": "added", "word": word, "lemma": lemma}
    raise HTTPException(status_code=409, detail="Word already in learn list")


@app.delete("/api/learn-words/{word_id}")
def delete_learn(word_id: int, session: SessionDep):
    if db.delete_learn_word(session, word_id):
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Not found")


@app.post("/api/learn-words/{word_id}/mark-known")
def mark_known(word_id: int, session: SessionDep):
    if db.move_learn_to_known(session, word_id):
        return {"status": "moved to known"}
    raise HTTPException(status_code=404, detail="Not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=5000, reload=True)
