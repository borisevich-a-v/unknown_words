// === State ===
let analysisResult = null;
let currentModalWord = null; // { lemma, forms, contexts }
let learnLemmas = new Set(); // lemmas currently in the learn list
let selectedLemmaIdx = -1;

// === API helpers ===
async function api(path, opts = {}) {
    const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return res.json();
}

// === Navigation ===
function switchView(viewName) {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`).classList.add("active");
    const navBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
    if (navBtn) navBtn.classList.add("active");
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        switchView(btn.dataset.view);
        if (btn.dataset.view === "known") loadKnownWords();
        if (btn.dataset.view === "learn") loadLearnWords();
    });
});

// === Text Analysis ===
document.getElementById("btn-analyze").addEventListener("click", analyzeText);
document.getElementById("btn-clear").addEventListener("click", () => {
    document.getElementById("text-input").value = "";
    analysisResult = null;
});

async function analyzeText(startIdx = 0) {
    const text = document.getElementById("text-input").value.trim();
    if (!text) return;

    const btn = document.getElementById("btn-analyze");
    btn.textContent = "Analyzing…";
    btn.disabled = true;

    try {
        const [result, learnRows] = await Promise.all([
            api("/api/analyze", { method: "POST", body: { text } }),
            api("/api/learn-words"),
        ]);
        learnLemmas = new Set(learnRows.map((w) => w.lemma));
        analysisResult = result;
        renderStats(analysisResult.stats);
        renderTokens(analysisResult.tokens, analysisResult.unknown_words);
        switchView("result");
        selectWordAtIdx(startIdx);
    } catch (e) {
        console.error(e);
        alert("Analysis failed. Is the server running?");
    } finally {
        btn.textContent = "Analyze";
        btn.disabled = false;
    }
}

function renderStats(stats) {
    document.getElementById("stat-total").textContent = stats.total_words;
    document.getElementById("stat-unique").textContent = stats.unique_lemmas;
    document.getElementById("stat-known").textContent = stats.known_count;
    document.getElementById("stat-unknown").textContent = stats.unknown_count;
    document.getElementById("stat-coverage").textContent = stats.coverage_pct + "%";
    document.getElementById("stats-bar").classList.remove("hidden");
}

function renderTokens(tokens, unknownWords) {
    const panel = document.getElementById("result-panel");
    panel.innerHTML = "";
    panel.classList.remove("hidden");

    tokens.forEach((tok) => {
        if (tok.is_word) {
            const span = document.createElement("span");
            span.textContent = tok.text;
            const isLearning = !tok.known && learnLemmas.has(tok.lemma);
            span.className = tok.known
                ? "word-token word-known-tag"
                : isLearning
                ? "word-token word-learning"
                : "word-token word-unknown";

            if (!tok.known) {
                span.dataset.lemma = tok.lemma;
                span.addEventListener("click", () => {
                    selectedLemmaIdx = getOrderedUnknownLemmas().indexOf(tok.lemma);
                    openWordModal(tok.lemma, unknownWords[tok.lemma]);
                });
            }
            panel.appendChild(span);
        } else {
            panel.appendChild(document.createTextNode(tok.text));
        }
        // Add whitespace
        if (tok.whitespace) {
            panel.appendChild(document.createTextNode(tok.whitespace));
        }
    });
}

// === Word Review Modal ===
function openWordModal(lemma, info) {
    currentModalWord = info;
    document.getElementById("modal-word").textContent = info.forms.join(", ");
    document.getElementById("modal-lemma-text").textContent = info.lemma;

    const ctxDiv = document.getElementById("modal-contexts");
    ctxDiv.innerHTML = "";
    info.contexts.forEach((ctx) => {
        const div = document.createElement("div");
        div.className = "modal-context-item";
        // Highlight the word forms in context
        let html = escapeHtml(ctx);
        info.forms.forEach((form) => {
            const re = new RegExp(`\\b(${escapeRegex(form)})\\b`, "gi");
            html = html.replace(re, "<mark>$1</mark>");
        });
        div.innerHTML = html;
        ctxDiv.appendChild(div);
    });

    document.getElementById("modal-overlay").classList.remove("hidden");
    document.getElementById("btn-add-learn").focus();

    fetchTranslation(info.forms[0], info.contexts[0] || "");
}

async function fetchTranslation(word, context) {
    const translationDiv = document.getElementById("modal-translation");
    const bodyDiv = document.getElementById("translation-body");

    translationDiv.classList.remove("hidden");
    bodyDiv.innerHTML = '<span class="translation-loading">Translating…</span>';

    try {
        const result = await api("/api/translate", {
            method: "POST",
            body: { word, context },
        });
        bodyDiv.innerHTML = `
            <div class="translation-word">${escapeHtml(result.word_translation)}</div>
            <div class="translation-context">${escapeHtml(result.minimal_context)} — ${escapeHtml(result.context_translation)}</div>
        `;
    } catch (e) {
        bodyDiv.innerHTML = '<span class="translation-error">Translation failed.</span>';
    }
}

function closeWordModal() {
    document.getElementById("modal-overlay").classList.add("hidden");
    document.getElementById("modal-translation").classList.add("hidden");
    currentModalWord = null;
}

document.querySelector(".modal-close").addEventListener("click", closeWordModal);
document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeWordModal();
});

function getOrderedUnknownLemmas() {
    if (!analysisResult) return [];
    const seen = new Set();
    const lemmas = [];
    for (const tok of analysisResult.tokens) {
        if (tok.is_word && !tok.known && tok.lemma && !seen.has(tok.lemma)) {
            seen.add(tok.lemma);
            lemmas.push(tok.lemma);
        }
    }
    return lemmas;
}

async function addSelectedToKnown() {
    const lemmas = getOrderedUnknownLemmas();
    if (selectedLemmaIdx < 0 || selectedLemmaIdx >= lemmas.length) return;
    const savedIdx = selectedLemmaIdx;
    const lemma = lemmas[savedIdx];
    const info = analysisResult.unknown_words[lemma];
    await api("/api/known-words", { method: "POST", body: { word: info.forms[0], lemma } });
    refreshCounts();
    await analyzeText(savedIdx);
}

async function addSelectedToLearn() {
    const lemmas = getOrderedUnknownLemmas();
    if (selectedLemmaIdx < 0 || selectedLemmaIdx >= lemmas.length) return;
    const savedIdx = selectedLemmaIdx;
    const lemma = lemmas[savedIdx];
    const info = analysisResult.unknown_words[lemma];
    const context = info.contexts[0] || "";
    await api("/api/learn-words", { method: "POST", body: { word: info.forms[0], lemma, context } });
    learnLemmas.add(lemma);
    refreshCounts();
    renderTokens(analysisResult.tokens, analysisResult.unknown_words);
    selectWordAtIdx(savedIdx);
}

function selectWordAtIdx(idx) {
    const lemmas = getOrderedUnknownLemmas();
    if (lemmas.length === 0) { selectedLemmaIdx = -1; return; }
    idx = ((idx % lemmas.length) + lemmas.length) % lemmas.length;
    selectedLemmaIdx = idx;

    document.querySelectorAll(".word-selected").forEach((el) => el.classList.remove("word-selected"));

    const lemma = lemmas[idx];
    const span = document.querySelector(`[data-lemma="${CSS.escape(lemma)}"]`);
    if (span) {
        span.classList.add("word-selected");
        span.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

function openSelectedWordModal() {
    const lemmas = getOrderedUnknownLemmas();
    if (selectedLemmaIdx < 0 || selectedLemmaIdx >= lemmas.length) return;
    const lemma = lemmas[selectedLemmaIdx];
    openWordModal(lemma, analysisResult.unknown_words[lemma]);
}

document.addEventListener("keydown", (e) => {
    const modalOpen = !document.getElementById("modal-overlay").classList.contains("hidden");

    if (modalOpen) {
        if (e.key === "Escape") closeWordModal();
        return;
    }

    const resultActive = document.getElementById("view-result").classList.contains("active");
    if (!resultActive) return;

    if (e.key === "ArrowLeft" || e.key === "a") {
        e.preventDefault();
        selectWordAtIdx(selectedLemmaIdx - 1);
    } else if (e.key === "ArrowRight" || e.key === "d") {
        e.preventDefault();
        selectWordAtIdx(selectedLemmaIdx + 1);
    } else if (e.key === "Enter") {
        e.preventDefault();
        openSelectedWordModal();
    } else if (e.key === "k") {
        e.preventDefault();
        addSelectedToKnown();
    } else if (e.key === "l") {
        e.preventDefault();
        addSelectedToLearn();
    }
});

document.getElementById("btn-mark-known").addEventListener("click", async () => {
    if (!currentModalWord) return;
    const word = currentModalWord.forms[0];
    const lemma = currentModalWord.lemma;
    const savedIdx = selectedLemmaIdx;
    await api("/api/known-words", { method: "POST", body: { word, lemma } });
    closeWordModal();
    refreshCounts();
    analyzeText(savedIdx);
});

document.getElementById("btn-add-learn").addEventListener("click", async () => {
    if (!currentModalWord) return;
    const word = currentModalWord.forms[0];
    const lemma = currentModalWord.lemma;
    const context = currentModalWord.contexts[0] || "";
    await api("/api/learn-words", { method: "POST", body: { word, lemma, context } });
    learnLemmas.add(lemma);
    closeWordModal();
    if (analysisResult) renderTokens(analysisResult.tokens, analysisResult.unknown_words);
    refreshCounts();
});

// === Known Words List ===
let knownWordsCache = [];

async function loadKnownWords() {
    knownWordsCache = await api("/api/known-words");
    renderKnownWords(knownWordsCache);
    document.getElementById("known-count").textContent = knownWordsCache.length;
}

function renderKnownWords(words) {
    const list = document.getElementById("known-list");
    if (words.length === 0) {
        list.innerHTML = '<div class="word-list-empty">No known words yet. Analyze a text or add words manually.</div>';
        return;
    }
    list.innerHTML = words.map((w) => `
        <div class="word-item" data-id="${w.id}">
            <div class="word-info">
                <span class="word-text">${escapeHtml(w.word)}</span>
                <span class="word-lemma-tag">${escapeHtml(w.lemma)}</span>
            </div>
            <div class="word-actions">
                <button class="btn-danger" onclick="deleteKnown(${w.id})" title="Remove">✕</button>
            </div>
        </div>
    `).join("");
}

document.getElementById("known-search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = knownWordsCache.filter(
        (w) => w.word.includes(q) || w.lemma.includes(q)
    );
    renderKnownWords(filtered);
});

async function deleteKnown(id) {
    await api(`/api/known-words/${id}`, { method: "DELETE" });
    loadKnownWords();
}

// Add single word
document.getElementById("btn-add-known").addEventListener("click", () => {
    const word = prompt("Enter a word to add:");
    if (word && word.trim()) {
        api("/api/known-words", { method: "POST", body: { word: word.trim() } }).then(() => {
            loadKnownWords();
            refreshCounts();
        });
    }
});

// Bulk add
document.getElementById("btn-bulk-add").addEventListener("click", () => {
    document.getElementById("bulk-modal-overlay").classList.remove("hidden");
});

document.querySelectorAll(".bulk-modal-close").forEach((el) => {
    el.addEventListener("click", () => {
        document.getElementById("bulk-modal-overlay").classList.add("hidden");
    });
});

document.getElementById("btn-bulk-submit").addEventListener("click", async () => {
    const input = document.getElementById("bulk-input").value.trim();
    if (!input) return;
    const words = input.split("\n").map((w) => w.trim()).filter(Boolean);
    const result = await api("/api/known-words/bulk", { method: "POST", body: { words } });
    alert(`Added ${result.added} words (${result.skipped} already existed).`);
    document.getElementById("bulk-input").value = "";
    document.getElementById("bulk-modal-overlay").classList.add("hidden");
    loadKnownWords();
    refreshCounts();
});

// === Learn Words List ===
let learnWordsCache = [];
let selectedLearnIds = new Set();
let lastLearnClickIdx = -1;
let displayedLearnWords = [];

async function loadLearnWords() {
    learnWordsCache = await api("/api/learn-words");
    learnLemmas = new Set(learnWordsCache.map((w) => w.lemma));
    selectedLearnIds = new Set();
    lastLearnClickIdx = -1;
    renderLearnWords(learnWordsCache);
    document.getElementById("learn-count").textContent = learnWordsCache.length;
}

function renderLearnWords(words) {
    displayedLearnWords = words;
    const list = document.getElementById("learn-list");
    if (words.length === 0) {
        list.innerHTML = '<div class="word-list-empty">No words in your learn list yet.</div>';
        updateLearnBulkBar();
        return;
    }
    list.innerHTML = words.map((w, i) => `
        <div class="word-item learn-item${selectedLearnIds.has(w.id) ? " selected" : ""}" data-id="${w.id}" data-idx="${i}">
            <div class="word-info">
                <span class="word-text">${escapeHtml(w.word)}</span>
                <span class="word-lemma-tag">${escapeHtml(w.lemma)}</span>
                <span class="word-date">${formatDate(w.created_at)}</span>
            </div>
            <span class="word-context" title="${escapeHtml(w.context || "")}">${escapeHtml(w.context || "")}</span>
            <div class="word-actions">
                <button class="btn-primary btn-sm" onclick="markLearnAsKnown(${w.id})">I know this</button>
                <button class="btn-danger" onclick="deleteLearn(${w.id})" title="Remove">✕</button>
            </div>
        </div>
    `).join("");
    updateLearnBulkBar();
}

document.getElementById("learn-list").addEventListener("click", (e) => {
    const item = e.target.closest(".learn-item");
    if (!item) return;
    if (e.target.closest(".word-actions")) return;

    const id = parseInt(item.dataset.id);
    const idx = parseInt(item.dataset.idx);

    if (e.shiftKey && lastLearnClickIdx !== -1) {
        const start = Math.min(lastLearnClickIdx, idx);
        const end = Math.max(lastLearnClickIdx, idx);
        for (let i = start; i <= end; i++) {
            selectedLearnIds.add(displayedLearnWords[i].id);
        }
    } else {
        if (selectedLearnIds.has(id)) {
            selectedLearnIds.delete(id);
        } else {
            selectedLearnIds.add(id);
        }
        lastLearnClickIdx = idx;
    }

    renderLearnWords(displayedLearnWords);
});

function updateLearnBulkBar() {
    const bar = document.getElementById("learn-bulk-bar");
    const count = selectedLearnIds.size;
    if (count === 0) {
        bar.classList.add("hidden");
    } else {
        bar.classList.remove("hidden");
        document.getElementById("learn-selection-count").textContent =
            `${count} selected`;
    }
}

document.getElementById("btn-bulk-mark-known").addEventListener("click", async () => {
    const ids = [...selectedLearnIds];
    await Promise.all(ids.map((id) => api(`/api/learn-words/${id}/mark-known`, { method: "POST" })));
    selectedLearnIds = new Set();
    lastLearnClickIdx = -1;
    await loadLearnWords();
    refreshCounts();
});

function downloadCsv(words, filename) {
    const rows = [["word", "lemma", "context", "created_at"]];
    words.forEach((w) => rows.push([w.word, w.lemma, w.context || "", w.created_at]));
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    triggerDownload(csv, filename, "text/csv");
}

function downloadWordsOnly(words, filename) {
    const text = words.map((w) => w.word).join("\n");
    triggerDownload(text, filename, "text/plain");
}

function triggerDownload(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

document.getElementById("btn-download-csv").addEventListener("click", () => {
    downloadCsv(learnWordsCache, "learn_words.csv");
});

document.getElementById("btn-download-words").addEventListener("click", () => {
    downloadWordsOnly(learnWordsCache, "learn_words.txt");
});

document.getElementById("btn-bulk-export-csv").addEventListener("click", () => {
    const words = learnWordsCache.filter((w) => selectedLearnIds.has(w.id));
    downloadCsv(words, "selected_words.csv");
});

document.getElementById("btn-bulk-export-words").addEventListener("click", () => {
    const words = learnWordsCache.filter((w) => selectedLearnIds.has(w.id));
    downloadWordsOnly(words, "selected_words.txt");
});

document.getElementById("btn-bulk-delete").addEventListener("click", async () => {
    const ids = [...selectedLearnIds];
    await Promise.all(ids.map((id) => api(`/api/learn-words/${id}`, { method: "DELETE" })));
    selectedLearnIds = new Set();
    lastLearnClickIdx = -1;
    await loadLearnWords();
});

document.getElementById("btn-clear-selection").addEventListener("click", () => {
    selectedLearnIds = new Set();
    lastLearnClickIdx = -1;
    renderLearnWords(displayedLearnWords);
});

document.getElementById("learn-search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = learnWordsCache.filter(
        (w) => w.word.includes(q) || w.lemma.includes(q)
    );
    lastLearnClickIdx = -1;
    renderLearnWords(filtered);
});

async function deleteLearn(id) {
    selectedLearnIds.delete(id);
    await api(`/api/learn-words/${id}`, { method: "DELETE" });
    loadLearnWords();
}

async function markLearnAsKnown(id) {
    selectedLearnIds.delete(id);
    await api(`/api/learn-words/${id}/mark-known`, { method: "POST" });
    loadLearnWords();
    refreshCounts();
}

// === Refresh badge counts ===
async function refreshCounts() {
    const known = await api("/api/known-words");
    const learn = await api("/api/learn-words");
    document.getElementById("known-count").textContent = known.length;
    document.getElementById("learn-count").textContent = learn.length;
}

// === Utilities ===
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(raw) {
    if (!raw) return "";
    const d = new Date(raw.replace(" ", "T") + "Z");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// === Init ===
refreshCounts();
