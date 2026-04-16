import re
import spacy

nlp = None


def load_model():
    global nlp
    if nlp is None:
        nlp = spacy.load("en_core_web_md")
    return nlp


def lemmatize(word: str) -> str:
    """Return the lemma of a single word."""
    model = load_model()
    doc = model(word.lower().strip())
    if doc and len(doc) > 0:
        return doc[0].lemma_
    return word.lower().strip()


def analyze_text(text: str, known_lemmas: set, known_words: set = None) -> dict:
    """
    Analyze text and return structured result with word-level annotations.

    Returns:
        {
            "tokens": [
                {
                    "text": "original text chunk",
                    "is_word": true/false,
                    "lemma": "lemma" or null,
                    "known": true/false,
                    "position": index
                },
                ...
            ],
            "unknown_words": {
                "lemma": {
                    "lemma": "...",
                    "forms": ["form1", "form2"],
                    "contexts": ["sentence containing the word"]
                }
            },
            "stats": {
                "total_words": int,
                "unique_words": int,
                "known_count": int,
                "unknown_count": int,
                "coverage_pct": float
            }
        }
    """
    model = load_model()
    doc = model(text)

    tokens = []
    unknown_words = {}
    seen_lemmas = set()
    total_words = 0
    known_count = 0

    for token in doc:
        lemma = token.lemma_.lower()
        is_word = token.is_alpha and not token.is_space

        token_data = {
            "text": token.text,
            "whitespace": token.whitespace_,
            "is_word": is_word,
            "lemma": lemma if is_word else None,
            "known": False,
            "position": token.i,
        }

        if is_word:
            total_words += 1
            word_form = token.text.lower()
            is_known = lemma in known_lemmas or (known_words is not None and word_form in known_words)
            token_data["known"] = is_known

            if is_known:
                known_count += 1
            else:
                # Track unknown word info
                if lemma not in unknown_words:
                    unknown_words[lemma] = {
                        "lemma": lemma,
                        "forms": [],
                        "contexts": [],
                    }
                form = token.text.lower()
                if form not in unknown_words[lemma]["forms"]:
                    unknown_words[lemma]["forms"].append(form)
                # Extract sentence as context
                sent_text = token.sent.text.strip()
                if sent_text not in unknown_words[lemma]["contexts"]:
                    unknown_words[lemma]["contexts"].append(sent_text)

            seen_lemmas.add(lemma)

        tokens.append(token_data)

    unique_count = len(seen_lemmas)
    unknown_count = unique_count - len(seen_lemmas & known_lemmas)

    return {
        "tokens": tokens,
        "unknown_words": unknown_words,
        "stats": {
            "total_words": total_words,
            "unique_lemmas": unique_count,
            "known_count": len(seen_lemmas & known_lemmas),
            "unknown_count": unknown_count,
            "coverage_pct": round(
                (len(seen_lemmas & known_lemmas) / unique_count * 100)
                if unique_count > 0
                else 0,
                1,
            ),
        },
    }
