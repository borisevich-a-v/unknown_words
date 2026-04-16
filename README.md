# Word Analyzer

A local web app that analyzes English text against your personal vocabulary database. Paste any text, see which words you don't know yet, and build your word lists.

## Features

- **Text Analysis** — Paste text, get instant highlighting of unknown words
- **Lemmatization** — Uses spaCy NLP so "running", "ran", "runs" all map to "run"
- **Word Review** — Click any highlighted word to see it in context
- **Known Words DB** — SQLite-backed database of words you already know
- **Learn List** — Separate list for words you want to study
- **Bulk Import** — Add hundreds of known words at once

## Setup

```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Download the English language model
python -m spacy download en-core-web-md

# 3. Run the app
python app.py
```

Open **http://localhost:5000** in your browser.

The SQLite database (`words.db`) is created automatically on first run.

## Project Structure

```
word-analyzer/
├── app.py              # Flask server + API routes
├── database.py         # SQLite queries
├── nlp_engine.py       # spaCy lemmatization + text analysis
├── words.db            # SQLite database (auto-created)
├── requirements.txt
├── static/
│   ├── style.css
│   └── app.js
└── templates/
    └── index.html
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analyze` | Analyze text, returns tokens + stats |
| GET | `/api/known-words` | List all known words |
| POST | `/api/known-words` | Add a known word |
| POST | `/api/known-words/bulk` | Add multiple words at once |
| PUT | `/api/known-words/:id` | Update a known word |
| DELETE | `/api/known-words/:id` | Delete a known word |
| GET | `/api/learn-words` | List learn words |
| POST | `/api/learn-words` | Add to learn list |
| DELETE | `/api/learn-words/:id` | Remove from learn list |
| POST | `/api/learn-words/:id/mark-known` | Move to known words |
