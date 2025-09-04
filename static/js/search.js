// /static/js/search.js — optimized global search with snippets + highlighting
(function () {
  // ---------- Elements ----------
  const input     = document.getElementById("searchInput");
  const statusEl  = document.getElementById("searchStatus");
  const resultsEl = document.getElementById("searchResults");
  const dataEl    = document.getElementById("search-data");

  if (!input || !resultsEl) return;

  // ---------- Resolve index URL (works in local dev and production) ----------
  let indexUrl = (dataEl && dataEl.dataset && dataEl.dataset.indexUrl) || "/search_index.en.json";
  try {
    const u = new URL(indexUrl, window.location.origin);
    indexUrl = window.location.origin + u.pathname; // force same-origin path
  } catch (_) {
    // keep as-is if URL parsing fails
  }

  // ---------- Small helpers ----------
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function tokenize(q) {
    return (q || "").toLowerCase().split(/[\s\-_/.,:;!?()]+/).filter(Boolean);
  }

  // Build a short snippet around the first match and highlight tokens
  function buildSnippet(text, query, maxLen = 200) {
    if (!text) return "";
    const lc = text.toLowerCase();
    const tokens = tokenize(query);
    if (!tokens.length) return text.slice(0, maxLen);

    // find earliest occurrence of any token
    let pos = -1;
    for (const t of tokens) {
      const p = lc.indexOf(t);
      if (p !== -1 && (pos === -1 || p < pos)) pos = p;
    }
    if (pos === -1) return text.slice(0, maxLen);

    const start = Math.max(0, pos - Math.floor(maxLen / 3));
    const end   = Math.min(text.length, start + maxLen);
    const slice = text.slice(start, end);

    // escape + highlight
    const esc = (s) => s.replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    let html = esc(slice);
    tokens.forEach((t) => {
      if (!t) return;
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`, "gi");
      html = html.replace(re, "<mark>$1</mark>");
    });

    return (start > 0 ? "…" : "") + html + (end < text.length ? "…" : "");
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- Load Zola's prebuilt elasticlunr index ----------
  fetch(indexUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch ${indexUrl}: ${r.status}`);
      return r.json();
    })
    .then((raw) => {
      // Load the real index Zola produced
      const idx = elasticlunr.Index.load(raw);

      // Determine which fields actually exist in this index (Zola usually: ["title","body"])
      const _fields = (idx.getFields ? idx.getFields() : idx._fields) || [];
      const hasField = (f) => Array.isArray(_fields) && _fields.indexOf(f) !== -1;

      // Original documents live here
      const store = (idx.documentStore && idx.documentStore.docs) ? idx.documentStore.docs : {};
      const refs  = Object.keys(store);

      setStatus(`Ready — ${refs.length} pages indexed`);

      // ---------- Render with snippets + highlighting ----------
      function render(hits, query) {
        resultsEl.innerHTML = "";
        if (!hits.length) {
          resultsEl.innerHTML = "<p class=\"muted\">No results.</p>";
          return;
        }
        const ul = document.createElement("ul");
        hits.forEach((hit) => {
          const doc = store[hit.ref] || {};
          const li  = document.createElement("li");

          const a = document.createElement("a");
          a.href = doc.permalink || doc.url || hit.ref || "#";
          a.textContent = doc.title || doc.permalink || "Untitled";
          li.appendChild(a);

          const rawText = (doc.summary || doc.description || doc.content || doc.body || "").toString();
          const snippet = buildSnippet(rawText, query, 200);
          if (snippet) {
            const p = document.createElement("div");
            p.className = "muted";
            p.style.marginTop = ".25rem";
            p.innerHTML = snippet; // safe: escaped+marked inside buildSnippet
            li.appendChild(p);
          }

          ul.appendChild(li);
        });
        resultsEl.appendChild(ul);
      }

      // ---------- Search (better scoring) ----------
      function doSearch(q) {
        const query = (q || "").trim();
        if (query.length < 2) {
          resultsEl.innerHTML = "";
          return;
        }

        const opts = { bool: "OR", expand: true };
        const boosted = {};
        if (hasField("title"))       boosted.title = { boost: 8 };
        if (hasField("summary"))     boosted.summary = { boost: 4 };
        if (hasField("description")) boosted.description = { boost: 4 };
        if (hasField("body"))        boosted.body = { boost: 2 };
        if (hasField("content"))     boosted.content = { boost: 2 };
        if (Object.keys(boosted).length) {
          opts.fields = boosted;
        }
        const hits = idx.search(query, opts);

        // Sort DESC by score and take top 20
        const top = hits.sort((a,b) => (b.score - a.score)).slice(0, 20);
        render(top, query);
      }

      // Input wiring + support for prefilled ?q=
      input.addEventListener("input", debounce((e) => doSearch(e.target.value), 120));

      // ---- Expose small hooks so other scripts (or JSON-LD SearchAction) can trigger a search ----
      // A promise that resolves when the index and wiring are ready
      if (!window.__searchReady) {
        let _resolve;
        window.__searchReady = new Promise((res) => { _resolve = res; });
        // Store the resolver to call after wiring
        window.__searchReady.__resolve = _resolve;
      }

      // Public function to trigger a search programmatically
      window.__doSearch = (q) => {
        const query = (q || '').toString();
        input.value = query;
        doSearch(query);
      };

      // Signal ready now that index + listeners are live
      if (window.__searchReady && typeof window.__searchReady.__resolve === 'function') {
        window.__searchReady.__resolve();
        delete window.__searchReady.__resolve;
      }

      // Hydrate from ?q= if present
      const params = new URLSearchParams(location.search);
      const preset = params.get('q');
      if (preset) {
        window.__doSearch(preset);
      }
    })
    .catch((e) => {
      console.error(e);
      setStatus("Search failed to load.");
    });
})();