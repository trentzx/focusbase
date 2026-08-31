# Focusbase

A local-first personal startup dashboard: a live clock and greeting, weather,
a daily focus/todo list, class assignments pulled from your syllabi, your
open GitHub pull requests, your upcoming Google Calendar events, a built-in
scratchpad, and a local AI assistant — all in one terminal-style page you can
set as what opens when you get on your PC.

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

## Google Calendar

The calendar panel shows your next 7 days of events on your primary calendar.
It needs a Google OAuth client ID, since Calendar data requires you to sign
in — this app never sees your Google password.

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   and create an **OAuth client ID** of type **Web application**.
2. Under **Authorized JavaScript origins**, add the URL this app runs on
   (e.g. `http://localhost:5173` for `npm run dev`).
3. Enable the **Google Calendar API** for that project if prompted.
4. Copy the client ID and paste it into the calendar panel, then click
   **connect Google Calendar** and approve the read-only calendar scope.

The client ID is stored in local storage; the access token Google issues
after you sign in is kept in memory only, so you'll reconnect each time you
reload the page. Only read access is requested (`calendar.readonly`) — the
dashboard can't create, edit, or delete events.

## Notepad

A free-form scratchpad panel (`~/notes.scratch`) for jotting ideas — it
autosaves to your browser's local storage a moment after you stop typing, and
the `clear` button wipes it (with a confirmation) if you want a clean slate.

## Storage & code layout

- Everything (focus tasks, assignments, GitHub config, notepad contents) is
  stored in your browser's local storage, not on a server. The Google
  Calendar access token is the one exception — it's kept in memory only and
  is never persisted.
- The dashboard grid is defined in `src/main.jsx`; styling lives in
  `src/styles.css`.
