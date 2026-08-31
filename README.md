# Focusbase

A local-first personal startup dashboard: a live clock and greeting, weather,
a daily focus/todo list, class assignments pulled from your syllabi, your
open GitHub pull requests, and a local AI assistant — all in one terminal-style
page you can set as what opens when you get on your PC.

Adapted from the [relay](https://github.com/7shep/relay) reference project.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`). To open it
automatically when you log in, point a shortcut in your Startup folder at
`npm run dev` in this folder, or build it (`npm run build`) and serve/open
`dist/index.html`.

## GitHub pull requests

The pulls panel asks for your GitHub username the first time it loads. Public
repositories work with no token. Add a read-only GitHub Personal Access Token
if you want private repositories or a higher API rate limit. Both are stored
in this browser's local storage only — nothing leaves your machine except the
direct calls to the GitHub API.

## Assignments from your syllabi

The assignments panel uses local Qwen through Ollama to extract assignments,
exams, labs, projects, and due dates from syllabus text or text-based PDFs.
Click `add syllabus` and select `.txt`, `.md`, `.csv`, `.json`, `.html`, or
`.pdf` files. Extracted assignments are normalized and stored in browser local
storage so Qwen can use them when drafting your daily focus list. Scanned
PDFs without selectable text need OCR before import.

## Local AI assistant

The assistant dock sends real streaming chat requests to local Ollama at
`http://localhost:11434` using `qwen2.5:7b`. Install
[Ollama](https://ollama.com), run:

```bash
ollama pull qwen2.5:7b
```

then start Ollama and keep it running while you use the dashboard. Each
request includes your current focus tasks and extracted assignment queue.
Ask it to add or create a task and it will fill in the label, project,
estimate, due date, description, and timeline before adding it to your list.

## Weather

Weather comes from your browser's geolocation plus the free
[Open-Meteo](https://open-meteo.com) API — no API key needed. Allow the
location permission prompt the first time the page loads.

## Notes

- Everything (focus tasks, assignments, GitHub config) is stored in your
  browser's local storage, not on a server.
- The dashboard grid is defined in `src/main.jsx`; styling lives in
  `src/styles.css`.
