import os
from typing import Generator

from sqlalchemy import (
    Column, Integer, String, Text, create_engine, func, select, delete, update
)
from sqlalchemy.orm import DeclarativeBase, Session

DB_PATH = os.path.join(os.path.dirname(__file__), "words.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


class Base(DeclarativeBase):
    pass


class KnownWord(Base):
    __tablename__ = "known_words"

    id = Column(Integer, primary_key=True, autoincrement=True)
    word = Column(String, nullable=False, unique=True)
    lemma = Column(String, nullable=False, index=True)
    created_at = Column(String, nullable=False, server_default=func.datetime("now"))


class LearnWord(Base):
    __tablename__ = "learn_words"

    id = Column(Integer, primary_key=True, autoincrement=True)
    word = Column(String, nullable=False, unique=True)
    lemma = Column(String, nullable=False, index=True)
    context = Column(Text, nullable=True)
    created_at = Column(String, nullable=False, server_default=func.datetime("now"))


def init_db():
    Base.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


# --- Known Words ---

def get_all_known_words(session: Session) -> list[KnownWord]:
    return session.scalars(select(KnownWord).order_by(KnownWord.created_at.desc())).all()


def get_known_lemmas(session: Session) -> set[str]:
    return set(session.scalars(select(KnownWord.lemma)).all())


def get_known_words_set(session: Session) -> set[str]:
    return set(session.scalars(select(KnownWord.word)).all())


def add_known_word(session: Session, word: str, lemma: str) -> bool:
    word = word.lower().strip()
    lemma = lemma.lower().strip()
    existing = session.scalar(select(KnownWord).where(KnownWord.word == word))
    if existing:
        if existing.lemma != lemma:
            existing.lemma = lemma
            session.commit()
        return True
    session.add(KnownWord(word=word, lemma=lemma))
    session.commit()
    return True


def update_known_word(session: Session, word_id: int, word: str, lemma: str) -> bool:
    duplicate = session.scalar(
        select(KnownWord).where(KnownWord.word == word.lower().strip(), KnownWord.id != word_id)
    )
    if duplicate:
        return False
    result = session.execute(
        update(KnownWord)
        .where(KnownWord.id == word_id)
        .values(word=word.lower().strip(), lemma=lemma.lower().strip())
    )
    session.commit()
    return result.rowcount > 0


def delete_known_word(session: Session, word_id: int) -> bool:
    result = session.execute(delete(KnownWord).where(KnownWord.id == word_id))
    session.commit()
    return result.rowcount > 0


# --- Learn Words ---

def get_all_learn_words(session: Session) -> list[LearnWord]:
    return session.scalars(select(LearnWord).order_by(LearnWord.created_at.desc())).all()


def add_learn_word(session: Session, word: str, lemma: str, context: str | None = None) -> bool:
    existing = session.scalar(select(LearnWord).where(LearnWord.word == word.lower().strip()))
    if existing:
        return False
    session.add(LearnWord(word=word.lower().strip(), lemma=lemma.lower().strip(), context=context))
    session.commit()
    return True


def delete_learn_word(session: Session, word_id: int) -> bool:
    result = session.execute(delete(LearnWord).where(LearnWord.id == word_id))
    session.commit()
    return result.rowcount > 0


def move_learn_to_known(session: Session, word_id: int) -> bool:
    row = session.get(LearnWord, word_id)
    if not row:
        return False
    add_known_word(session, row.word, row.lemma)
    session.execute(delete(LearnWord).where(LearnWord.id == word_id))
    session.commit()
    return True
