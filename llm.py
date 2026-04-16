import json
import os

from openai import OpenAI

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def translate_word_in_context(word: str, context: str) -> dict:
    """Return translation and minimal meaningful context for the word."""
    client = get_client()

    prompt = (
        f"You are a language assistant. Given an English word and the sentence it appears in, provide:\n"
        f'1. "word_translation" — a concise Russian translation of the word as used in that sentence\n'
        f'2. "minimal_context" — the shortest meaningful phrase or clause from the sentence that '
        f"best captures how the word is used (ideally 3–8 words)\n"
        f'3. "context_translation" — Russian translation of that minimal context phrase\n\n'
        f"Word: {word}\n"
        f"Sentence: {context}\n\n"
        f'Respond ONLY with a JSON object: {{"word_translation": "...", "minimal_context": "...", "context_translation": "..."}}'
    )

    response = client.chat.completions.create(
        model="gpt-5.4-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        max_completion_tokens=200,
        temperature=0.2,
    )

    return json.loads(response.choices[0].message.content)
