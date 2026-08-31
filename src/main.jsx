import React, { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './styles.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const seedTasks = [
  { id: 't1', label: 'Connect GitHub in the pull requests panel', project: 'focusbase', estimate: '5m', due: '', description: 'Open the pull requests panel on the right and add your GitHub username (and a token if you want private repos or a higher rate limit) to make it live.', timeline: ['Scroll to the pulls panel', 'Enter your GitHub username', 'Optionally add a read-only personal access token'], done: false },
  { id: 't2', label: 'Import a syllabus to populate assignments', project: 'focusbase', estimate: '5m', due: '', description: 'Click "add syllabus" in the assignments panel and choose a .txt, .md, .csv, .json, .html, or .pdf file to extract due dates automatically.', timeline: ['Open the assignments panel', 'Click add syllabus', 'Pick a syllabus file'], done: false },
  { id: 't3', label: 'Install Ollama and pull qwen2.5:7b for the assistant', project: 'focusbase', estimate: '10m', due: '', description: 'The assistant dock talks to a local Ollama server. Install Ollama, run "ollama pull qwen2.5:7b", and keep it running while you use the dashboard.', timeline: ['Install Ollama', 'Run ollama pull qwen2.5:7b', 'Start Ollama and try a prompt in the assistant'], done: false },
]

const FOCUS_STATE_KEY = 'start.focus.state'
const ASSIGNMENTS_STATE_KEY = 'start.assignments'

function createBlankTask() {
  return { id: `task-${Date.now()}-${Math.round(Math.random() * 1000)}`, label: '', project: 'focusbase', estimate: '30m', due: '', description: '', timeline: [], done: false }
}

function dayKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function readFocusState(date) {
  const today = dayKey(date)
  try {
    const saved = JSON.parse(window.localStorage.getItem(FOCUS_STATE_KEY))
    if (!saved || !Array.isArray(saved.tasks)) return { day: today, tasks: seedTasks, shouldDraft: false }
    if (saved.day === today) return { day: today, tasks: saved.tasks, shouldDraft: false }
    return { day: today, tasks: saved.tasks.filter((task) => !task.done), shouldDraft: true }
  } catch {
    return { day: today, tasks: seedTasks, shouldDraft: false }
  }
}

function readAssignments() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(ASSIGNMENTS_STATE_KEY))
    if (!Array.isArray(saved)) return []
    return saved.map((item, index) => ({
      id: String(item?.id || `assignment-${index}`),
      course: String(item?.course || '').trim(),
      title: String(item?.title || '').trim(),
      kind: String(item?.kind || 'assignment').trim(),
      dueInHours: item?.dueInHours !== undefined && item?.dueInHours !== null && item?.dueInHours !== '' && Number.isFinite(Number(item.dueInHours)) ? Number(item.dueInHours) : null,
      dueAt: String(item?.dueAt || '').trim(),
      weight: String(item?.weight || '').trim(),
      source: String(item?.source || '').trim(),
    })).filter((item) => item.title && !item.id.startsWith('google-'))
  } catch {
    return []
  }
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start >= 0 && end >= start) return JSON.parse(cleaned.slice(start, end + 1))
  const parsed = JSON.parse(cleaned)
  return parsed.assignments || parsed.tasks || []
}

function formatSyllabusDue(value) {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`)).toLowerCase()
}

function normalizeSyllabusAssignments(items, now, sourceNames) {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => {
    const title = String(item?.title || item?.label || '').trim()
    const course = String(item?.course || '').trim()
    const dueAt = String(item?.dueAt || item?.due || '').trim().slice(0, 10)
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? new Date(`${dueAt}T23:59:00`) : null
    const dueInHours = dueDate && !Number.isNaN(dueDate.getTime()) ? Math.max(0, Math.round((dueDate.getTime() - now.getTime()) / 3600000)) : null
    return {
      id: `syllabus-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`,
      course,
      title,
      kind: String(item?.kind || (/midterm|exam|quiz|test/i.test(title) ? 'exam' : 'assignment')).trim(),
      dueInHours,
      dueAt: formatSyllabusDue(dueAt),
      weight: String(item?.weight || '').trim(),
      source: sourceNames.join(', '),
    }
  }).filter((item) => item.title)
}

async function draftAssignmentsFromSyllabi(sources, now, signal) {
  const prompt = `You are Qwen, a local academic planning assistant. Extract every upcoming assignment, project, paper, lab, quiz, exam, midterm, presentation, or report from these syllabi. Do not invent work that is not in the source. Return only a JSON object with an assignments array. Each assignment must contain exactly: title, course, kind, dueAt, weight. Use ISO dates (YYYY-MM-DD) for dueAt when a date is stated; otherwise use an empty string. Preserve the course name and grading weight when available.

Current date: ${dayKey(now)}

Syllabi:
${sources.map((source) => `--- ${source.name} ---\n${source.text}`).join('\n\n')}`
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: 'qwen2.5:7b',
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: 'Extract only assignments explicitly present in the supplied syllabi. Output valid JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Qwen returned ${response.status}`)
  const data = await response.json()
  const content = data.message?.content || data.response || ''
  return normalizeSyllabusAssignments(extractJson(content), now, sources.map((source) => source.name))
}

async function readSyllabusFile(file) {
  if (!/\.pdf$/i.test(file.name)) return { name: file.name, text: await file.text() }
  const document = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => item.str).join(' '))
  }
  const text = pages.join('\n\n').trim()
  if (!text) throw new Error(`${file.name} has no selectable text. Scanned PDFs need OCR before import.`)
  return { name: file.name, text }
}

function normalizeDraftTasks(items) {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => ({
    id: `qwen-${Date.now()}-${index}`,
    label: String(item?.label || '').trim(),
    project: String(item?.project || item?.course || 'school').trim(),
    estimate: String(item?.estimate || '30m').trim(),
    due: String(item?.due || '').trim(),
    description: String(item?.description || 'Drafted by Qwen from the upcoming assignment queue.').trim(),
    timeline: Array.isArray(item?.timeline) ? item.timeline.map((step) => String(step).trim()).filter(Boolean) : [],
    done: false,
  })).filter((task) => task.label)
}

async function draftFocusTasks(today, carriedTasks, assignments, signal) {
  const prompt = `You are Qwen, a local planning assistant. Draft 2 to 4 concrete focus tasks for ${today} from the upcoming assignments and midterms below. Prioritize the closest deadlines and high-weight work. Do not duplicate the carried-over tasks. Return only a JSON array with objects containing exactly: label, project, estimate, due, description, timeline. Use short labels, estimates like "45m" or "2h", ISO dates for due when known, and 2 to 4 timeline steps.\n\nUpcoming assignments:\n${JSON.stringify(assignments)}\n\nCarried-over incomplete tasks:\n${JSON.stringify(carriedTasks)}`
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: 'qwen2.5:7b',
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: 'You create concise, actionable study and work plans. Output valid JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Qwen returned ${response.status}`)
  const data = await response.json()
  const content = data.message?.content || data.response || ''
  return normalizeDraftTasks(extractJson(content))
}

async function draftTasksFromPrompt(prompt, currentTasks, assignments, signal) {
  const today = dayKey(new Date())
  const request = `You are Qwen, a local task-planning assistant. Turn the user's request into one to three concrete focus tasks. Fill in every field using the request, the assignment queue, and reasonable planning judgment. Do not invent deadlines or grading weights. Return only a JSON object with a tasks array. Each task must contain exactly: label, project, estimate, due, description, timeline. Use short labels, estimates like "45m" or "2h", ISO dates for due when known, and 2 to 4 timeline steps.

Today: ${today}
User request: ${prompt}

Current focus tasks:
${JSON.stringify(currentTasks)}

Assignment queue:
${JSON.stringify(assignments)}`
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: 'qwen2.5:7b',
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: 'Create complete, actionable focus tasks. Output valid JSON only.' },
        { role: 'user', content: request },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Qwen returned ${response.status}`)
  const data = await response.json()
  const content = data.message?.content || data.response || ''
  return normalizeDraftTasks(extractJson(content))
}

const fallbackWeather = {
  location: 'Current location',
  temp: 20,
  feelsLike: 19,
  condition: 'Locating weather',
  high: 23,
  low: 13,
  windKmh: 11,
  humidity: 48,
  hourly: [
    { hour: '15', temp: 70 },
    { hour: '16', temp: 71 },
    { hour: '17', temp: 69 },
    { hour: '18', temp: 66 },
    { hour: '19', temp: 62 },
    { hour: '20', temp: 59 },
  ],
}

function greetingFor(date) {
  const hour = date.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatClock(date) {
  return date.toLocaleTimeString('en-US', { hour12: false })
}

function formatDateLine(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toLowerCase()
}

function dueLabel(hours) {
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function dueClock(hours, now) {
  const due = new Date(now.getTime() + hours * 3600 * 1000)
  return due.toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).toLowerCase()
}

function relativeAgo(hours) {
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function relativeUpdated(timestamp) {
  const hours = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 3600000))
  return relativeAgo(hours)
}

function formatTaskDue(value) {
  if (!value) return 'No due date set'
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
}

function readGitHubConfig() {
  try {
    return JSON.parse(window.localStorage.getItem('start.github.config')) || { username: '', token: '' }
  } catch {
    return { username: '', token: '' }
  }
}

async function githubJson(url, token, signal) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(url, { headers, signal })
  if (response.ok) return response.json()
  if (response.status === 401) throw new Error('GitHub rejected the token. Check it and try again.')
  if (response.status === 403) throw new Error('GitHub rate limit reached. Add a token or try again later.')
  if (response.status === 404) throw new Error('GitHub could not access one of these repositories. Check the token permissions.')
  throw new Error(`GitHub returned ${response.status}.`)
}

async function githubPages(url, token, signal) {
  const results = []
  for (let page = 1; page <= 10; page += 1) {
    const joiner = url.includes('?') ? '&' : '?'
    const pageItems = await githubJson(`${url}${joiner}per_page=100&page=${page}`, token, signal)
    if (!Array.isArray(pageItems)) return results
    results.push(...pageItems)
    if (pageItems.length < 100) break
  }
  return results
}

function normalizePullRequest(item, username, fallbackRepo = '') {
  const repo = fallbackRepo || item.repository_url?.replace('https://api.github.com/repos/', '') || item.base?.repo?.full_name || 'unknown/repository'
  return {
    id: `${repo}#${item.number}`,
    number: item.number,
    repo,
    title: item.title,
    author: item.user?.login || 'unknown',
    branch: item.head?.ref || '',
    url: item.html_url,
    updatedAt: item.updated_at,
    draft: Boolean(item.draft),
    isMine: item.user?.login?.toLowerCase() === username.toLowerCase(),
  }
}

async function loadGitHubPullRequests(username, token, signal) {
  const query = encodeURIComponent(`is:pr is:open author:${username}`)
  const authoredItems = await githubPages(`https://api.github.com/search/issues?q=${query}&sort=updated&order=desc`, token, signal)
  const mine = authoredItems.map((item) => normalizePullRequest(item, username))
  const ownedRepositories = await githubPages(`https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated&direction=desc`, token, signal)
  const repoNames = ownedRepositories
    .filter((repository) => repository.owner?.login?.toLowerCase() === username.toLowerCase())
    .map((repository) => repository.full_name)
    .filter(Boolean)
  const repositories = []

  for (const repo of repoNames) {
    const repoItems = await githubPages(`https://api.github.com/repos/${repo}/pulls?state=open&sort=updated&direction=desc`, token, signal)
    const pullRequests = repoItems.map((item) => normalizePullRequest(item, username, repo))
    if (pullRequests.length) repositories.push({ name: repo, pullRequests })
  }

  return { mine, repositories }
}

function weatherDescription(code) {
  if (code === 0) return 'Clear sky'
  if ([1, 2].includes(code)) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if ([45, 48].includes(code)) return 'Foggy'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67].includes(code)) return 'Rain'
  if ([71, 73, 75, 77].includes(code)) return 'Snow'
  if ([80, 81, 82].includes(code)) return 'Rain showers'
  if ([85, 86].includes(code)) return 'Snow showers'
  if ([95, 96, 99].includes(code)) return 'Thunderstorms'
  return 'Current conditions'
}

async function loadWeather(latitude, longitude, signal) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
    forecast_days: '1',
  })
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
  if (!response.ok) throw new Error('Weather request failed')
  const data = await response.json()
  const currentHour = data.hourly.time.findIndex((time) => time >= data.current.time)
  const start = currentHour < 0 ? 0 : currentHour
  const hourly = data.hourly.time.slice(start, start + 6).map((time, index) => ({
    hour: time.slice(11, 13),
    temp: Math.round(data.hourly.temperature_2m[start + index]),
  }))

  let location = 'Current location'
  try {
    const reverseParams = new URLSearchParams({ format: 'jsonv2', lat: String(latitude), lon: String(longitude), zoom: '10', addressdetails: '1' })
    const reverseResponse = await fetch(`https://nominatim.openstreetmap.org/reverse?${reverseParams}`, { signal })
    if (reverseResponse.ok) {
      const reverseData = await reverseResponse.json()
      const address = reverseData.address || {}
      const city = address.city || address.town || address.village || address.municipality
      const region = address.state_code || address.state
      if (city) location = region ? `${city}, ${region}` : city
    }
  } catch {
    // Weather still works if the optional city lookup is unavailable.
  }

  return {
    location,
    temp: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    condition: weatherDescription(data.current.weather_code),
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    windKmh: Math.round(data.current.wind_speed_10m),
    humidity: Math.round(data.current.relative_humidity_2m),
    hourly: hourly.length ? hourly : fallbackWeather.hourly,
  }
}

function App() {
  const [now, setNow] = useState(() => new Date())
  const [focusState] = useState(() => readFocusState(new Date()))
  const [tasks, setTasks] = useState(() => focusState.tasks)
  const [focusDay, setFocusDay] = useState(() => focusState.day)
  const [focusStatus, setFocusStatus] = useState(() => focusState.shouldDraft ? 'planning' : 'ready')
  const [assignments, setAssignments] = useState(readAssignments)
  const [syllabusState, setSyllabusState] = useState({ status: 'idle', error: '' })
  const [showCompleted, setShowCompleted] = useState(() => !(focusState.tasks.length && focusState.tasks.every((task) => task.done)))
  const [taskStatus, setTaskStatus] = useState('idle')
  const [selectedTask, setSelectedTask] = useState(null)
  const [weather, setWeather] = useState(fallbackWeather)
  const [weatherStatus, setWeatherStatus] = useState('locating')
  const tasksRef = useRef(tasks)
  const assignmentsRef = useRef(assignments)
  const lastFocusDayRef = useRef(focusState.day)
  const draftControllerRef = useRef(null)
  const taskControllerRef = useRef(null)
  const syllabusControllerRef = useRef(null)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const runFocusDraft = useCallback(async (day, carriedTasks) => {
    draftControllerRef.current?.abort()
    if (!assignmentsRef.current.length) {
      setFocusStatus('no-data')
      return
    }
    const controller = new AbortController()
    draftControllerRef.current = controller
    setFocusStatus('planning')

    try {
      const draftedTasks = await draftFocusTasks(day, carriedTasks, assignmentsRef.current, controller.signal)
      if (controller.signal.aborted || lastFocusDayRef.current !== day) return
      setTasks((current) => [...current, ...draftedTasks])
      setFocusStatus(draftedTasks.length ? 'ready' : 'offline')
    } catch (error) {
      if (!controller.signal.aborted && lastFocusDayRef.current === day) setFocusStatus('offline')
    }
  }, [])

  useEffect(() => {
    tasksRef.current = tasks
    try {
      window.localStorage.setItem(FOCUS_STATE_KEY, JSON.stringify({ day: focusDay, tasks }))
    } catch {
      // The focus list still works when browser storage is unavailable.
    }
  }, [tasks, focusDay])

  useEffect(() => {
    assignmentsRef.current = assignments
    try {
      window.localStorage.setItem(ASSIGNMENTS_STATE_KEY, JSON.stringify(assignments))
    } catch {
      // Assignment data still remains available for this session when storage is unavailable.
    }
  }, [assignments])

  useEffect(() => {
    if (tasks.length && tasks.every((task) => task.done)) setShowCompleted(false)
  }, [tasks])

  useEffect(() => {
    if (focusState.shouldDraft) runFocusDraft(focusState.day, tasksRef.current)
    return () => draftControllerRef.current?.abort()
  }, [focusState, runFocusDraft])

  useEffect(() => {
    const today = dayKey(now)
    if (today === lastFocusDayRef.current) return

    lastFocusDayRef.current = today
    const carriedTasks = tasksRef.current.filter((task) => !task.done)
    setFocusDay(today)
    setTasks(carriedTasks)
    setSelectedTask((current) => current && current.done ? null : current)
    runFocusDraft(today, carriedTasks)
  }, [now, runFocusDraft])

  const importSyllabi = useCallback(async (files) => {
    if (!files.length) return
    syllabusControllerRef.current?.abort()
    const controller = new AbortController()
    syllabusControllerRef.current = controller
    setSyllabusState({ status: 'importing', error: '' })
    try {
      const sources = await Promise.all(files.map(async (file) => {
        if (!/\.(txt|md|csv|json|html?|pdf)$/i.test(file.name)) throw new Error(`${file.name} is not a supported syllabus. Use .txt, .md, .csv, .json, .html, or .pdf.`)
        return readSyllabusFile(file)
      }))
      const importedAssignments = await draftAssignmentsFromSyllabi(sources, now, controller.signal)
      if (controller.signal.aborted) return
      setAssignments((current) => {
        const next = [...current]
        importedAssignments.forEach((item) => {
          const duplicate = next.find((existing) => existing.title.toLowerCase() === item.title.toLowerCase() && existing.course.toLowerCase() === item.course.toLowerCase())
          if (duplicate) Object.assign(duplicate, item)
          else next.push(item)
        })
        return next.sort((a, b) => (a.dueInHours ?? Number.MAX_SAFE_INTEGER) - (b.dueInHours ?? Number.MAX_SAFE_INTEGER))
      })
      setSyllabusState({ status: importedAssignments.length ? 'ready' : 'empty', error: '' })
    } catch (error) {
      if (!controller.signal.aborted && error.name !== 'AbortError') setSyllabusState({ status: 'error', error: error.message })
    }
  }, [now])

  useEffect(() => () => syllabusControllerRef.current?.abort(), [])

  useEffect(() => () => taskControllerRef.current?.abort(), [])

  const clearAssignments = useCallback(() => {
    window.localStorage.removeItem(ASSIGNMENTS_STATE_KEY)
    setAssignments([])
    setSyllabusState({ status: 'idle', error: '' })
  }, [])

  useEffect(() => {
    if (!selectedTask) return undefined
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSelectedTask(null)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [selectedTask])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    if (!navigator.geolocation) {
      setWeatherStatus('unavailable')
      return () => controller.abort()
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        if (cancelled) return
        setWeatherStatus('updating')
        try {
          const currentWeather = await loadWeather(coords.latitude, coords.longitude, controller.signal)
          if (!cancelled) {
            setWeather(currentWeather)
            setWeatherStatus('live')
          }
        } catch {
          if (!cancelled) setWeatherStatus('offline')
        }
      },
      () => {
        if (!cancelled) setWeatherStatus('permission needed')
      },
      { enableHighAccuracy: false, maximumAge: 15 * 60 * 1000, timeout: 10000 },
    )

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const toggleTask = useCallback((id) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
    setSelectedTask((current) => current && current.id === id ? { ...current, done: !current.done } : current)
  }, [])

  const createTasksFromPrompt = useCallback(async (prompt) => {
    taskControllerRef.current?.abort()
    const controller = new AbortController()
    taskControllerRef.current = controller
    setTaskStatus('planning')

    try {
      const draftedTasks = await draftTasksFromPrompt(prompt, tasksRef.current, assignmentsRef.current, controller.signal)
      if (controller.signal.aborted) return []
      setTasks((current) => [...current, ...draftedTasks])
      if (draftedTasks[0]) setSelectedTask(draftedTasks[0])
      setTaskStatus(draftedTasks.length ? 'ready' : 'empty')
      return draftedTasks
    } catch (error) {
      if (!controller.signal.aborted) setTaskStatus('offline')
      throw error
    } finally {
      if (taskControllerRef.current === controller) taskControllerRef.current = null
    }
  }, [])

  const updateTask = useCallback((id, updates) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...updates } : task)))
    setSelectedTask((current) => current && current.id === id ? { ...current, ...updates } : current)
  }, [])

  const deleteTask = useCallback((id) => {
    setTasks((current) => current.filter((task) => task.id !== id))
    setSelectedTask((current) => current && current.id === id ? null : current)
  }, [])

  const addTask = useCallback(() => {
    const task = createBlankTask()
    setTasks((current) => [...current, task])
    setSelectedTask(task)
  }, [])

  const closeTaskModal = useCallback(() => {
    setSelectedTask((current) => {
      if (current && !current.label) setTasks((tasks) => tasks.filter((task) => task.id !== current.id))
      return null
    })
  }, [])

  const tasksLeft = useMemo(() => tasks.filter((task) => !task.done).length, [tasks])

  return (
    <div className="terminal-app">
      <div className="dashboard-frame">
        <DashboardHeader name="Trenton" now={now} tasksLeft={tasksLeft} weather={weather} weatherStatus={weatherStatus} />

        <main className="dashboard-grid">
          <FocusTasks
            tasks={tasks}
            onOpen={setSelectedTask}
            onAdd={addTask}
            onDelete={deleteTask}
            showCompleted={showCompleted}
            onToggleCompleted={() => setShowCompleted((current) => !current)}
            focusStatus={focusStatus}
            taskStatus={taskStatus}
            index={0}
          />

          <div className="side-stack">
            <WeatherPanel index={1} weather={weather} weatherStatus={weatherStatus} />
            <AssignmentsPanel now={now} assignments={assignments} index={2} syllabusState={syllabusState} onImport={importSyllabi} onClear={clearAssignments} />
          </div>

          <PullRequestsPanel index={3} />
          <CalendarPanel index={4} />
          <NotesPanel index={5} />
        </main>

        <footer className="system-footer">
          <span>synced 2m ago</span>
          <span aria-hidden="true">·</span>
          <span>3 sources connected</span>
          <span aria-hidden="true">·</span>
          <span className="accent-text">all systems nominal</span>
        </footer>
      </div>
      {selectedTask && <TaskModal task={selectedTask} onClose={closeTaskModal} onToggle={toggleTask} onSave={updateTask} onDelete={deleteTask} />}
      <ChatBar tasks={tasks} assignments={assignments} onCreateTasks={createTasksFromPrompt} />
    </div>
  )
}

function DashboardHeader({ name, now, tasksLeft, weather, weatherStatus }) {
  return (
    <header className="dashboard-header">
      <div className="header-copy">
        <p className="command-line">trenton@focusbase:~$ ./dashboard --today</p>
        <h1><span className="accent-text">{greetingFor(now)},</span> {name}<span className="caret" aria-hidden="true" /></h1>
        <p className="header-meta">{formatDateLine(now)} <span aria-hidden="true">·</span> <span className="bright-text">{formatClock(now)}</span> <span aria-hidden="true">·</span> {tasksLeft} focus task{tasksLeft === 1 ? '' : 's'} remaining</p>
      </div>
      <div className="weather-summary">
        <span className="weather-glyph" aria-hidden="true">☼</span>
        <div><strong>{weather.temp}°C <span>/ {weather.condition.toLowerCase()}</span></strong><small>{weatherStatus === 'live' ? weather.location : `location ${weatherStatus}`}</small></div>
      </div>
    </header>
  )
}

function Panel({ path, meta, children, primary = false, index = 0, className = '' }) {
  return (
    <section className={`terminal-panel ${primary ? 'primary-panel' : ''} ${className}`} style={{ '--panel-delay': `${Math.min(index, 4) * 45}ms` }}>
      <header className="panel-header"><h2><span>$ cat </span>{path}</h2>{meta && <div className="panel-meta">{meta}</div>}</header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

function FocusTasks({ tasks, onOpen, onAdd, onDelete, showCompleted, onToggleCompleted, focusStatus, taskStatus, index }) {
  const completed = tasks.filter((task) => task.done).length
  const visible = showCompleted ? tasks : tasks.filter((task) => !task.done)
  const progress = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100)
  const syncLabel = taskStatus === 'planning' ? 'Qwen drafting task...' : taskStatus === 'offline' ? 'Qwen unavailable' : focusStatus === 'planning' ? 'Qwen drafting...' : focusStatus === 'offline' ? 'Qwen unavailable' : ''
  const syncState = taskStatus === 'planning' || taskStatus === 'offline' ? taskStatus : focusStatus

  return (
    <Panel path="~/focus/today.md" primary index={index} className="focus-panel" meta={<span className="focus-meta"><button type="button" className="panel-meta-button" onClick={onToggleCompleted}>{completed}/{tasks.length} done</button><button type="button" className="github-action focus-add-button" onClick={onAdd}>+ add task</button>{syncLabel && <span className={`focus-sync-status ${syncState}`}> · {syncLabel}</span>}</span>}>
      <div className="progress-row"><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div>
      <ul className="focus-list">
        {visible.map((task, position) => {
          const isNext = !task.done && visible.find((item) => !item.done)?.id === task.id
          return <li key={task.id} className="focus-task-row">
            <button className={`focus-task ${isNext ? 'next-task' : ''} ${task.done ? 'completed-task' : ''}`} onClick={() => onOpen(task)} aria-haspopup="dialog">
              <span className="task-box" aria-hidden="true">{task.done ? '×' : ''}</span>
              <span className="task-text"><strong>{task.label || 'untitled task'}</strong><small>{String(position + 1).padStart(2, '0')} · {task.project} · est {task.estimate}{isNext && <em> · up next</em>}</small></span><span className="task-open" aria-hidden="true">↗</span>
            </button>
            <button type="button" className="focus-task-delete" onClick={(event) => { event.stopPropagation(); onDelete(task.id) }} aria-label={`Delete ${task.label || 'task'}`} title="Delete task">×</button>
          </li>
        })}
        {visible.length === 0 && <li className="empty-task">everything checked off.<small>Ask Qwen in the assistant, or click + add task, to create another focus task.</small></li>}
      </ul>
    </Panel>
  )
}

function TaskModal({ task, onClose, onToggle, onSave, onDelete }) {
  const isNewTask = !task.label
  const [editing, setEditing] = useState(isNewTask)
  const [draft, setDraft] = useState({ ...task, timelineText: task.timeline?.join('\n') || '' })
  const closeRef = useRef(null)

  useEffect(() => {
    setDraft({ ...task, timelineText: task.timeline?.join('\n') || '' })
    setEditing(!task.label)
  }, [task])

  useEffect(() => {
    closeRef.current?.focus()
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return
      const dialog = closeRef.current?.closest('[role="dialog"]')
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll('button, input, textarea')].filter((element) => !element.disabled)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => document.removeEventListener('keydown', trapFocus)
  }, [])

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function save(event) {
    event.preventDefault()
    const label = draft.label.trim()
    if (!label) return
    const timeline = draft.timelineText.split('\n').map((line) => line.trim()).filter(Boolean)
    onSave(task.id, { label, description: draft.description.trim(), estimate: draft.estimate.trim() || '30m', due: draft.due, timeline })
    setEditing(false)
  }

  function cancelEdit() {
    if (isNewTask) onClose()
    else setEditing(false)
  }

  function deleteTask() {
    if (!window.confirm(`Delete "${task.label || 'this task'}"? This cannot be undone.`)) return
    onDelete(task.id)
    onClose()
  }

  const timelineText = editing ? draft.timelineText : task.timeline.join('\n')
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" aria-describedby="task-modal-description">
      <header className="task-modal-header"><span className="command-line">$ cat ~/focus/{isNewTask ? 'new-task' : `${task.id}.md`}</span><button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close task details">×</button></header>
      {editing ? <form className="task-edit-form" onSubmit={save}>
        <label><span>task</span><input value={draft.label} onChange={(event) => updateDraft('label', event.target.value)} placeholder="what needs doing?" autoFocus required /></label>
        <label><span>description</span><textarea value={draft.description} onChange={(event) => updateDraft('description', event.target.value)} rows="3" /></label>
        <div className="task-edit-grid"><label><span>estimate</span><input value={draft.estimate} onChange={(event) => updateDraft('estimate', event.target.value)} /></label><label><span>due date</span><input type="date" value={draft.due} onChange={(event) => updateDraft('due', event.target.value)} /></label></div>
        <label><span>timeline <small>one step per line</small></span><textarea value={timelineText} onChange={(event) => updateDraft('timelineText', event.target.value)} rows="5" /></label>
        <div className="task-modal-actions">{!isNewTask && <button type="button" className="modal-danger" onClick={deleteTask}>delete task</button>}<button type="button" className="modal-secondary" onClick={cancelEdit}>cancel</button><button type="submit" className="modal-primary">{isNewTask ? 'add task' : 'save changes'}</button></div>
      </form> : <div className="task-detail">
        <div className="task-detail-top"><span className="eyebrow">{task.project} · {task.done ? 'completed' : 'focus task'}</span><span className="task-detail-id">{task.id}</span></div>
        <h2 id="task-modal-title">{task.label}</h2>
        <p id="task-modal-description" className="task-description">{task.description || 'No description yet. Add context to make this task easier to pick back up.'}</p>
        <div className="task-facts"><div><span>estimate</span><strong>{task.estimate}</strong></div><div><span>due</span><strong>{formatTaskDue(task.due)}</strong></div></div>
        <div className="timeline-block"><span className="eyebrow">Suggested timeline</span><ol>{task.timeline?.length ? task.timeline.map((step, index) => <li key={`${step}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>) : <li className="timeline-empty">No timeline yet. Add one while editing.</li>}</ol></div>
        <div className="task-modal-actions"><button className="modal-danger" onClick={deleteTask}>delete task</button><button className="modal-secondary" onClick={() => setEditing(true)}>edit task</button><button className={`modal-primary ${task.done ? 'reopen-button' : ''}`} onClick={() => onToggle(task.id)}>{task.done ? 'reopen task' : 'mark complete'}</button></div>
      </div>}
    </section>
  </div>
}

const suggestedPrompts = [
  'Plan my afternoon around what’s due',
  'Which PR should I unblock first?',
  'Summarize my week',
]

const CHAT_ACTIVITY_LABELS = ['Thinking', 'Combobulating', 'Checking the dashboard', 'Writing']

function isTaskPrompt(prompt) {
  const mentionsTask = /\b(tasks?|todo|to-do|focus item|focus list)\b/i.test(prompt)
  const requestsCreation = /\b(add|create|capture|make)\b/i.test(prompt) || /\b(turn|convert)\b[\s\S]*\binto\b/i.test(prompt)
  return mentionsTask && requestsCreation
}

function renderInline(text, keyPrefix) {
  return text.split(/(\*\*.*?\*\*|`.*?`)/g).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>
    return <React.Fragment key={key}>{part}</React.Fragment>
  })
}

function AssistantMarkdown({ text }) {
  return <div className="assistant-markdown">{text.split('\n').map((line, index) => {
    const key = `line-${index}`
    if (!line) return <span className="assistant-break" key={key} aria-hidden="true" />
    if (line.startsWith('> ')) return <blockquote key={key}>{renderInline(line.slice(2), key)}</blockquote>
    if (/^\d+\. /.test(line)) {
      const [, number, content] = line.match(/^(\d+)\. (.*)$/)
      return <div className="assistant-list-item" key={key}><span>{number}.</span><p>{renderInline(content, key)}</p></div>
    }
    if (line.startsWith('- ')) return <div className="assistant-list-item assistant-bullet" key={key}><span>–</span><p>{renderInline(line.slice(2), key)}</p></div>
    if (line.startsWith('**') && line.endsWith('**')) return <p className="assistant-heading" key={key}>{renderInline(line, key)}</p>
    return <p key={key}>{renderInline(line, key)}</p>
  })}</div>
}

async function streamQwenChat(messages, onChunk, signal) {
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ model: 'qwen2.5:7b', stream: true, messages }),
  })
  if (!response.ok) throw new Error(`Qwen returned ${response.status}`)
  if (!response.body) {
    const data = await response.json()
    onChunk({ content: data.message?.content || data.response || '', thinking: data.message?.thinking || data.thinking || '' })
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach((line) => {
      if (!line.trim()) return
      const data = JSON.parse(line)
      onChunk({ content: data.message?.content || data.response || '', thinking: data.message?.thinking || data.thinking || '' })
    })
    if (done) break
  }
  if (buffer.trim()) {
    const data = JSON.parse(buffer)
    onChunk({ content: data.message?.content || data.response || '', thinking: data.message?.thinking || data.thinking || '' })
  }
}

function ChatBar({ tasks, assignments, onCreateTasks }) {
  const [isOpen, setIsOpen] = useState(true)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const scrollRef = useRef(null)
  const chatControllerRef = useRef(null)
  const activityTimerRef = useRef(null)

  useEffect(() => () => {
    chatControllerRef.current?.abort()
    if (activityTimerRef.current) window.clearInterval(activityTimerRef.current)
  }, [])

  useEffect(() => {
    if (isOpen && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, isOpen])

  function reset() {
    chatControllerRef.current?.abort()
    if (activityTimerRef.current) window.clearInterval(activityTimerRef.current)
    setMessages([])
    setIsStreaming(false)
    setThinkingOpen(false)
  }

  async function send(value) {
    const prompt = value.trim()
    if (!prompt || isStreaming) return
    const assistantId = Date.now()
    const context = `Dashboard context:\nFocus tasks:\n${JSON.stringify(tasks)}\n\nAssignment queue:\n${JSON.stringify(assignments)}`
    const history = messages.filter((message) => message.role === 'user' || (message.role === 'assistant' && message.content)).slice(-8).map((message) => ({ role: message.role, content: message.content }))
    setMessages((current) => [...current, { role: 'user', content: prompt }, { id: assistantId, role: 'assistant', content: '', thinking: '', phase: 'thinking', activity: CHAT_ACTIVITY_LABELS[0] }])
    setDraft('')
    setThinkingOpen(true)
    setIsStreaming(true)
    const controller = new AbortController()
    chatControllerRef.current = controller
    let activityIndex = 0
    activityTimerRef.current = window.setInterval(() => {
      activityIndex = (activityIndex + 1) % CHAT_ACTIVITY_LABELS.length
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, activity: CHAT_ACTIVITY_LABELS[activityIndex] } : message))
    }, 1400)
    try {
      if (isTaskPrompt(prompt)) {
        const draftedTasks = await onCreateTasks(prompt)
        if (!controller.signal.aborted) {
          const summary = draftedTasks.length
            ? `Added ${draftedTasks.length} focus task${draftedTasks.length === 1 ? '' : 's'} through Qwen.\n\n${draftedTasks.map((task, index) => `${index + 1}. **${task.label}** - ${task.project}, ${task.estimate}${task.due ? `, due ${task.due}` : ''}`).join('\n')}`
            : 'Qwen could not turn that request into a concrete focus task.'
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, phase: 'done', content: summary, thoughtSeconds: Math.max(1, Math.round((Date.now() - assistantId) / 1000)) } : message))
        }
      } else {
        await streamQwenChat([
          { role: 'system', content: 'You are Qwen, the local assistant inside the Start dashboard. Be concise, practical, and ground your answer in the dashboard context. Explain your recommendation briefly, and never claim to have taken an action you did not take.' },
          ...history,
          { role: 'user', content: `${prompt}\n\n${context}` },
        ], ({ content, thinking }) => {
          if (!content && !thinking) return
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, phase: content ? 'answering' : message.phase, content: `${message.content}${content}`, thinking: `${message.thinking}${thinking}` } : message))
        }, controller.signal)
        if (!controller.signal.aborted) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, phase: 'done', thoughtSeconds: Math.max(1, Math.round((Date.now() - assistantId) / 1000)) } : message))
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, phase: 'error', activity: 'Qwen unavailable', content: `I couldn’t reach local Qwen. Start Ollama and make sure qwen2.5:7b is installed.\n\n${error.message}` } : message))
    } finally {
      if (activityTimerRef.current) window.clearInterval(activityTimerRef.current)
      activityTimerRef.current = null
      if (chatControllerRef.current === controller) chatControllerRef.current = null
      setIsStreaming(false)
      setThinkingOpen(false)
    }
  }

  function stop() {
    chatControllerRef.current?.abort()
    if (activityTimerRef.current) window.clearInterval(activityTimerRef.current)
    activityTimerRef.current = null
    setIsStreaming(false)
    setThinkingOpen(false)
    setMessages((current) => current.map((message) => message.phase === 'thinking' || message.phase === 'answering' ? { ...message, phase: 'done', activity: 'Stopped' } : message))
  }

  function submit(event) {
    event.preventDefault()
    send(draft)
  }

  return <aside className={`assistant-dock ${isOpen ? 'is-open' : 'is-collapsed'}`} aria-label="Assistant sidebar">
    {isOpen ? <>
      <header className="assistant-header">
        <h2><span className="assistant-spark" aria-hidden="true">✣</span><span>~/assistant</span><span className="assistant-model">qwen-2.5-7b</span></h2>
        <div className="assistant-actions">
          <button type="button" className="assistant-icon-button" onClick={reset} aria-label="New conversation" title="New conversation">↻</button>
          <button type="button" className="assistant-icon-button" onClick={() => setIsOpen(false)} aria-label="Collapse assistant" title="Collapse assistant">⇥</button>
        </div>
      </header>
      <div ref={scrollRef} className="assistant-messages" aria-live="polite" aria-busy={isStreaming}>
        {!messages.length ? <div className="assistant-empty-state">
          <p><span className="accent-text">assistant</span> connected to this dashboard.</p>
          <p>It can see your focus list, assignment queue, open pull requests, and today’s forecast. Ask it to triage, plan, or explain anything on screen.</p>
          <div className="assistant-prompts">{suggestedPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => send(prompt)}><span aria-hidden="true">&gt;</span>{prompt}</button>)}</div>
        </div> : messages.map((message, index) => message.role === 'user' ? <div className="assistant-user-message" key={`${message.role}-${index}`}>{message.content}</div> : <div className="assistant-response" key={message.id}>
          <button type="button" className="assistant-thinking-toggle" onClick={() => setThinkingOpen((value) => !value)} aria-expanded={thinkingOpen}><span aria-hidden="true">›</span>{message.phase === 'done' ? `Thought for ${message.thoughtSeconds || 1}s` : message.activity || 'Thinking'}</button>
          {thinkingOpen && message.thinking ? <p className="assistant-thinking-copy">{message.thinking}</p> : null}
          {message.content ? <AssistantMarkdown text={message.content} /> : null}
        </div>)}
      </div>
      <form className="assistant-form" onSubmit={submit}>
        <span className="assistant-prompt-mark" aria-hidden="true">&gt;</span>
        <label className="visually-hidden" htmlFor="assistant-input">Ask the assistant</label>
        <input id="assistant-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="ask about your day..." />
        {isStreaming ? <button type="button" className="assistant-send" onClick={stop} aria-label="Stop generating">■</button> : <button type="submit" className="assistant-send" disabled={!draft.trim()} aria-label="Send message">↥</button>}
      </form>
      <p className="assistant-hint">enter to send · shift+enter for newline · reads your focus list, courses, repos &amp; forecast</p>
    </> : <button type="button" className="assistant-collapsed" onClick={() => setIsOpen(true)} aria-label="Open assistant" aria-expanded="false"><span aria-hidden="true">⇥</span><span>assistant</span>{isStreaming ? <i aria-hidden="true" /> : null}</button>}
  </aside>
}

function WeatherPanel({ index, weather, weatherStatus }) {
  const temps = weather.hourly.map((entry) => entry.temp)
  const min = Math.min(...temps)
  const max = Math.max(...temps)
  const span = Math.max(max - min, 1)

  return <Panel path="~/weather.now" index={index} className="weather-panel" meta={<span>{weather.location} · {weatherStatus}</span>}>
    <div className="weather-details"><div><strong className="large-temp">{weather.temp}°C</strong><p>feels {weather.feelsLike}° · {weather.condition.toLowerCase()}</p></div><dl><div><dt>↕</dt><dd><b>{weather.high}°</b> / {weather.low}°</dd></div><div><dt>⌁</dt><dd>{weather.windKmh} km/h</dd></div><div><dt>♢</dt><dd>{weather.humidity}%</dd></div></dl></div>
    <div className="forecast"><div className="forecast-bars">{weather.hourly.map((entry) => <div className="forecast-hour" key={entry.hour}><span>{entry.temp}</span><i style={{ height: `${12 + ((entry.temp - min) / span) * 30}px` }} /><small>{entry.hour}</small></div>)}</div></div>
  </Panel>
}

function AssignmentsPanel({ now, assignments, index, syllabusState, onImport, onClear }) {
  const soon = assignments.filter((item) => Number.isFinite(item.dueInHours) && item.dueInHours <= 24).length
  const meta = assignments.length ? <span>{assignments.length} queued <b className="danger-text">· {soon} due &lt;24h</b></span> : syllabusState.status === 'importing' ? <span>qwen extracting...</span> : null
  return <Panel path="~/edu/assignments" index={index} className="assignments-panel" meta={meta}>
    {assignments.length ? <><div className="assignment-toolbar"><span>source: syllabi · qwen-2.5-7b</span><SyllabusImportButton label="add more syllabi" onImport={onImport} /><button type="button" className="assignment-action" onClick={onClear}>clear</button></div><ol className="assignment-list"><span className="assignment-line" aria-hidden="true" />{assignments.map((item) => {
      const dueHours = Number.isFinite(item.dueInHours) ? item.dueInHours : null
      const dueText = item.dueAt || (dueHours === null ? 'date not set' : dueClock(dueHours, now))
      return <li key={item.id}><span className={`assignment-dot ${dueHours !== null && dueHours <= 12 ? 'danger-dot' : dueHours !== null && dueHours <= 48 ? 'warn-dot' : ''}`} aria-hidden="true" /><div><div className="assignment-title"><strong>{item.title}</strong><span className={dueHours !== null && dueHours <= 12 ? 'danger-text' : dueHours !== null && dueHours <= 48 ? 'warn-text' : ''}>{dueHours === null ? '—' : dueLabel(dueHours)}</span></div><small>{[item.course, item.kind, item.weight && `${item.weight} of grade`, `due ${dueText}`].filter(Boolean).join(' · ')}</small></div></li>
    })}</ol></> : <SyllabusSetup state={syllabusState} onImport={onImport} />}
  </Panel>
}

function SyllabusSetup({ state, onImport }) {
  if (state.status === 'importing') return <div className="assignment-empty"><strong>Qwen is reading your syllabi...</strong><small>Extracting dated assignments, exams, labs, and projects locally.</small></div>
  return <div className={`assignment-empty ${state.status === 'error' ? 'assignment-error' : ''}`}><strong>{state.status === 'empty' ? 'No assignments found.' : 'Add your syllabi.'}</strong><small>{state.status === 'error' ? state.error : 'Qwen will extract assignments and midterms from text-based syllabus files and PDFs.'}</small><SyllabusImportButton onImport={onImport} /><small>Supported: .txt, .md, .csv, .json, .html, and .pdf files.</small></div>
}

function SyllabusImportButton({ label = 'add syllabus', onImport }) {
  const inputRef = useRef(null)
  function chooseFiles(event) {
    onImport(Array.from(event.target.files || []))
    event.target.value = ''
  }
  return <><input ref={inputRef} className="visually-hidden" type="file" accept=".txt,.md,.csv,.json,.html,.htm,.pdf,text/plain,text/markdown,text/csv,application/json,text/html,application/pdf" multiple onChange={chooseFiles} /><button type="button" className="syllabus-connect" onClick={() => inputRef.current?.click()}>{label} <span aria-hidden="true">↗</span></button></>
}

function PullRequestsPanel({ index }) {
  const [config, setConfig] = useState(readGitHubConfig)
  const [draftUsername, setDraftUsername] = useState(config.username)
  const [draftToken, setDraftToken] = useState(config.token)
  const [state, setState] = useState({ status: config.username ? 'loading' : 'setup', data: null, error: '' })

  useEffect(() => {
    if (!config.username) return undefined
    let cancelled = false
    const controller = new AbortController()
    setState({ status: 'loading', data: null, error: '' })
    loadGitHubPullRequests(config.username, config.token, controller.signal)
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: '' }) })
      .catch((error) => { if (!cancelled && error.name !== 'AbortError') setState({ status: 'error', data: null, error: error.message }) })
    return () => { cancelled = true; controller.abort() }
  }, [config])

  function connect(event) {
    event.preventDefault()
    const username = draftUsername.trim()
    if (!username) return
    const next = { username, token: draftToken.trim() }
    window.localStorage.setItem('start.github.config', JSON.stringify(next))
    setConfig(next)
  }

  function disconnect() {
    window.localStorage.removeItem('start.github.config')
    setConfig({ username: '', token: '' })
    setDraftUsername('')
    setDraftToken('')
    setState({ status: 'setup', data: null, error: '' })
  }

  const meta = state.status === 'ready' ? <span>{state.data.mine.length} mine · {state.data.repositories.length} repos</span> : state.status === 'loading' ? <span>syncing...</span> : null
  return <Panel path="~/git/pulls --author=@me" index={index} className="pulls-panel" meta={meta}>
    {!config.username ? <GitHubSetup username={draftUsername} token={draftToken} onUsernameChange={setDraftUsername} onTokenChange={setDraftToken} onSubmit={connect} /> : state.status === 'loading' ? <div className="github-message"><span className="accent-text">◌</span> syncing open pull requests for {config.username}...</div> : state.status === 'error' ? <div className="github-message error-message"><strong>github sync failed</strong><span>{state.error}</span><div><button className="github-action" onClick={() => setConfig({ ...config })}>retry</button><button className="github-action" onClick={disconnect}>change account</button></div></div> : <GitHubDataView data={state.data} username={config.username} onDisconnect={disconnect} />}
  </Panel>
}

function GitHubSetup({ username, token, onUsernameChange, onTokenChange, onSubmit }) {
  return <form className="github-setup" onSubmit={onSubmit}>
    <div><span className="github-setup-icon accent-text" aria-hidden="true">♧</span><div><strong>Connect GitHub to make this panel live.</strong><p>Enter your username for public repositories. Add a Personal Access Token if you want private repositories and a higher API limit.</p></div></div>
    <div className="github-fields"><label><span>username</span><input value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder="your-github-name" autoComplete="username" /></label><label><span>token <small>(optional)</small></span><input type="password" value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder="github_pat_..." autoComplete="current-password" /></label><button className="github-connect" type="submit">connect ↵</button></div>
    <small className="github-security-note">For now, the token stays in this browser’s local storage. We can move it to the Windows keychain when we wrap Start in Tauri.</small>
  </form>
}

function GitHubDataView({ data, username, onDisconnect }) {
  const [hiddenPrIds, setHiddenPrIds] = useState(() => new Set())
  const visibleMine = data.mine.filter((pr) => !hiddenPrIds.has(pr.id))
  const visibleRepositories = data.repositories
    .map((repository) => ({ ...repository, pullRequests: repository.pullRequests.filter((pr) => !hiddenPrIds.has(pr.id)) }))
    .filter((repository) => repository.pullRequests.length)

  function hidePullRequest(prId) {
    setHiddenPrIds((current) => new Set([...current, prId]))
  }

  return <div className="github-data"><div className="github-toolbar"><span><span className="accent-text">●</span> connected as {username}</span><button className="github-action" onClick={onDisconnect}>disconnect</button></div><div className="github-scroll-region"><section className="github-section"><div className="github-section-header"><strong>1 · my open PRs</strong><span>{visibleMine.length}</span></div>{visibleMine.length ? <div className="github-pr-list">{visibleMine.map((pr) => <GitHubPRRow key={pr.id} pr={pr} showRepo onHide={hidePullRequest} />)}</div> : <p className="github-empty">No visible open PRs authored by {username}.</p>}</section><section className="github-section"><div className="github-section-header"><strong>2 · repos owned by me</strong><span>{visibleRepositories.length}</span></div>{visibleRepositories.length ? <div className="github-repository-list">{visibleRepositories.map((repository) => repository.pullRequests.length > 5 ? <GitHubRepositorySummary key={repository.name} repository={repository} /> : <div className="github-repository-group" key={repository.name}><div className="github-repository-title"><strong>{repository.name}</strong><span>{repository.pullRequests.length} open</span></div>{repository.pullRequests.map((pr) => <GitHubPRRow key={pr.id} pr={pr} showAuthor onHide={hidePullRequest} />)}</div>)}</div> : <p className="github-empty">No visible owned repositories with open PRs.</p>}</section></div></div>
}

function GitHubPRRow({ pr, showRepo, showAuthor, onHide }) {
  return <div className="github-pr-row"><a className="github-pr-link" href={pr.url} target="_blank" rel="noreferrer"><span className={`github-pr-icon ${pr.draft ? 'muted-text' : 'accent-text'}`} aria-hidden="true">♧</span><span className="github-pr-copy"><strong>{pr.title}{pr.draft && <small className="draft-label">draft</small>}</strong><small>{showRepo ? `${pr.repo} #${pr.number}` : `#${pr.number}`}{showAuthor ? ` · opened by ${pr.author}` : ''}{pr.branch ? ` · ${pr.branch}` : ''}</small></span><span className="github-pr-updated">{relativeUpdated(pr.updatedAt)}</span><span className="github-external" aria-hidden="true">↗</span></a><button type="button" className="github-pr-hide" onClick={() => onHide(pr.id)} aria-label={`Hide ${pr.title}`} title="Hide pull request">×</button></div>
}

function GitHubRepositorySummary({ repository }) {
  return <a className="github-repository-summary" href={`https://github.com/${repository.name}/pulls`} target="_blank" rel="noreferrer"><span className="github-pr-icon accent-text" aria-hidden="true">♧</span><span><strong>{repository.name}</strong><small>{repository.pullRequests.length} open PRs · showing repository instead</small></span><span className="github-external" aria-hidden="true">↗</span></a>
}

const CALENDAR_CLIENT_ID_KEY = 'start.calendar.clientId'
const CALENDAR_ID_KEY = 'start.calendar.calendarId'
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
let gisScriptPromise = null

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load Google Identity Services. Check your connection and try again.'))
      document.head.appendChild(script)
    })
  }
  return gisScriptPromise
}

function readCalendarClientId() {
  try {
    return window.localStorage.getItem(CALENDAR_CLIENT_ID_KEY) || ''
  } catch {
    return ''
  }
}

function readCalendarId() {
  try {
    return window.localStorage.getItem(CALENDAR_ID_KEY) || 'primary'
  } catch {
    return 'primary'
  }
}

function formatEventTime(event) {
  const startValue = event.start?.dateTime || event.start?.date
  if (!startValue) return 'time not set'
  if (!event.start?.dateTime) return `${new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(startValue)).toLowerCase()} · all day`
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(startValue)).toLowerCase()
}

async function fetchUpcomingEvents(accessToken, calendarId, signal) {
  const now = new Date()
  const weekAhead = new Date(now.getTime() + 7 * 24 * 3600 * 1000)
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: weekAhead.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '12',
  })
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (response.status === 401) throw new Error('Google rejected the access token. Reconnect and try again.')
  if (response.status === 404) throw new Error('That calendar could not be found. Pick a different one from the list.')
  if (!response.ok) throw new Error(`Google Calendar returned ${response.status}.`)
  const data = await response.json()
  return Array.isArray(data.items) ? data.items : []
}

async function fetchCalendarList(accessToken, signal) {
  const params = new URLSearchParams({ minAccessRole: 'reader', showHidden: 'false' })
  const response = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (!response.ok) return []
  const data = await response.json()
  const items = Array.isArray(data.items) ? data.items : []
  return items
    .map((item) => ({ id: item.id, summary: item.summaryOverride || item.summary || item.id, primary: Boolean(item.primary) }))
    .sort((a, b) => (b.primary - a.primary) || a.summary.localeCompare(b.summary))
}

function CalendarPanel({ index }) {
  const [clientId, setClientId] = useState(readCalendarClientId)
  const [draftClientId, setDraftClientId] = useState(clientId)
  const [editingClientId, setEditingClientId] = useState(!clientId)
  const [state, setState] = useState({ status: 'idle', events: [], calendars: [], error: '' })
  const [calendarId, setCalendarId] = useState(readCalendarId)
  const tokenClientRef = useRef(null)
  const accessTokenRef = useRef('')
  const calendarIdRef = useRef(calendarId)
  const fetchControllerRef = useRef(null)

  useEffect(() => () => fetchControllerRef.current?.abort(), [])

  const loadEvents = useCallback(async (accessToken, targetCalendarId) => {
    fetchControllerRef.current?.abort()
    const controller = new AbortController()
    fetchControllerRef.current = controller
    setState((current) => ({ ...current, status: 'loading', error: '' }))
    try {
      const events = await fetchUpcomingEvents(accessToken, targetCalendarId, controller.signal)
      if (!controller.signal.aborted) setState((current) => ({ ...current, status: 'ready', events, error: '' }))
    } catch (error) {
      if (!controller.signal.aborted && error.name !== 'AbortError') setState((current) => ({ ...current, status: 'error', events: [], error: error.message }))
    }
  }, [])

  const loadCalendars = useCallback(async (accessToken) => {
    try {
      const calendars = await fetchCalendarList(accessToken)
      setState((current) => ({ ...current, calendars }))
    } catch {
      // The calendar picker is a nice-to-have; events still load for the current selection.
    }
  }, [])

  const connect = useCallback(async () => {
    if (!clientId) return
    setState((current) => ({ ...current, status: 'connecting', error: '' }))
    try {
      await loadGoogleIdentityScript()
      if (!tokenClientRef.current || tokenClientRef.current.clientId !== clientId) {
        tokenClientRef.current = {
          clientId,
          client: window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: GOOGLE_CALENDAR_SCOPE,
            callback: (response) => {
              if (response.error) {
                setState((current) => ({ ...current, status: 'error', error: `Google sign-in failed: ${response.error}` }))
                return
              }
              accessTokenRef.current = response.access_token
              loadCalendars(response.access_token)
              loadEvents(response.access_token, calendarIdRef.current)
            },
          }),
        }
      }
      tokenClientRef.current.client.requestAccessToken({ prompt: accessTokenRef.current ? '' : 'consent' })
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', error: error.message }))
    }
  }, [clientId, loadCalendars, loadEvents])

  function selectCalendar(event) {
    const id = event.target.value
    calendarIdRef.current = id
    setCalendarId(id)
    try {
      window.localStorage.setItem(CALENDAR_ID_KEY, id)
    } catch {
      // The selection still applies for this session even when storage is unavailable.
    }
    if (accessTokenRef.current) loadEvents(accessTokenRef.current, id)
  }

  function saveClientId(event) {
    event.preventDefault()
    const trimmed = draftClientId.trim()
    if (!trimmed) return
    try {
      window.localStorage.setItem(CALENDAR_CLIENT_ID_KEY, trimmed)
    } catch {
      // Calendar still connects for this session even when storage is unavailable.
    }
    setClientId(trimmed)
    setEditingClientId(false)
  }

  function disconnect() {
    try {
      window.localStorage.removeItem(CALENDAR_CLIENT_ID_KEY)
    } catch {
      // Nothing else to clean up when storage is unavailable.
    }
    accessTokenRef.current = ''
    tokenClientRef.current = null
    setClientId('')
    setDraftClientId('')
    setEditingClientId(true)
    setState({ status: 'idle', events: [], calendars: [], error: '' })
  }

  const meta = state.status === 'ready' ? <span>{state.events.length} upcoming · 7 days</span> : state.status === 'loading' || state.status === 'connecting' ? <span>syncing...</span> : null
  const showPicker = (state.status === 'ready' || state.status === 'loading') && state.calendars.length > 0

  return (
    <Panel path="~/calendar.ics" index={index} className="calendar-panel" meta={meta}>
      {editingClientId ? (
        <div className="assignment-empty">
          <strong>Connect Google Calendar.</strong>
          <small>Create an OAuth client ID in Google Cloud Console (type: Web application) with your dev server's URL (e.g. <code>http://localhost:5173</code>) as an authorized JavaScript origin, then paste the client ID below.</small>
          <form className="calendar-fields" onSubmit={saveClientId}>
            <label><span>OAuth client ID</span><input value={draftClientId} onChange={(event) => setDraftClientId(event.target.value)} placeholder="123...apps.googleusercontent.com" autoComplete="off" /></label>
            <button type="submit" className="calendar-connect">save</button>
          </form>
          <small className="calendar-note">The client ID is stored in this browser's local storage only. <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">create one in Google Cloud Console ↗</a></small>
        </div>
      ) : state.status === 'idle' ? (
        <div className="assignment-empty">
          <strong>Ready to connect.</strong>
          <small>Sign in with Google to show your next 7 days of events.</small>
          <button type="button" className="syllabus-connect" onClick={connect}>connect Google Calendar ↗</button>
          <button type="button" className="assignment-action" onClick={() => setEditingClientId(true)}>edit client ID</button>
        </div>
      ) : state.status === 'connecting' ? (
        <div className="assignment-empty"><strong>Waiting on Google sign-in...</strong></div>
      ) : state.status === 'error' ? (
        <div className="assignment-empty assignment-error">
          <strong>Calendar sync failed.</strong>
          <small>{state.error}</small>
          <div className="calendar-toolbar"><span /><div><button type="button" className="github-action" onClick={connect}>retry</button><button type="button" className="github-action" onClick={disconnect}>change client ID</button></div></div>
        </div>
      ) : (
        <>
          <div className="calendar-toolbar">
            {showPicker ? (
              <select className="calendar-picker" value={calendarId} onChange={selectCalendar} aria-label="Choose a calendar">
                {state.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? ' (primary)' : ''}</option>)}
              </select>
            ) : <span>next 7 days</span>}
            <div><button type="button" className="github-action" onClick={connect}>refresh</button><button type="button" className="github-action" onClick={disconnect}>disconnect</button></div>
          </div>
          {state.status === 'loading' ? (
            <div className="assignment-empty"><strong>Syncing your calendar...</strong></div>
          ) : state.events.length ? (
            <ol className="assignment-list"><span className="assignment-line" aria-hidden="true" />
              {state.events.map((event) => (
                <li key={event.id}>
                  <span className="assignment-dot" aria-hidden="true" />
                  <div>
                    <div className="assignment-title"><strong>{event.summary || '(untitled event)'}</strong></div>
                    <small>{formatEventTime(event)}{event.location ? ` · ${event.location}` : ''}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="github-empty">Nothing on this calendar for the next 7 days.</p>}
        </>
      )}
    </Panel>
  )
}

const NOTES_STORAGE_KEY = 'start.notes'

function readNotes() {
  try {
    return window.localStorage.getItem(NOTES_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function NotesPanel({ index }) {
  const [notes, setNotes] = useState(readNotes)
  const [savedAt, setSavedAt] = useState(null)
  const saveTimerRef = useRef(null)

  useEffect(() => () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }, [])

  function updateNotes(value) {
    setNotes(value)
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(NOTES_STORAGE_KEY, value)
      } catch {
        // Notes remain available for this session even when storage is unavailable.
      }
      setSavedAt(new Date())
    }, 400)
  }

  function clearNotes() {
    if (!window.confirm('Clear all notes? This cannot be undone.')) return
    setNotes('')
    try {
      window.localStorage.removeItem(NOTES_STORAGE_KEY)
    } catch {
      // Nothing else to clean up when storage is unavailable.
    }
    setSavedAt(new Date())
  }

  return (
    <Panel path="~/notes.scratch" index={index} className="notes-panel" meta={savedAt ? <span>saved {relativeUpdated(savedAt.toISOString())}</span> : null}>
      <div className="notes-body">
        <textarea
          className="notes-textarea"
          value={notes}
          onChange={(event) => updateNotes(event.target.value)}
          placeholder="jot down ideas, links, anything worth keeping..."
          spellCheck="false"
        />
        <div className="notes-footer">
          <span>autosaves locally · never leaves this browser</span>
          <button type="button" className="notes-clear" onClick={clearNotes}>clear</button>
        </div>
      </div>
    </Panel>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
