"use strict";


const API_URL = "https://mental-health-score-o1dy.onrender.com";
const TIMEOUT_MS = 15000;
const MAX_SCORE = 10; // gauge scale; adjust if your model uses a different range

const form = document.getElementById("form");
const banner = document.getElementById("banner");
const submitBtn = document.getElementById("submit");
const btnText = submitBtn.querySelector(".btn-text");
const result = document.getElementById("result");
const ring = document.getElementById("ring");
const scoreEl = document.getElementById("score");
const bandEl = document.getElementById("band");
const adviceEl = document.getElementById("advice");

const RING_LENGTH = 2 * Math.PI * 52;

/* Mirrors the Pydantic constraints in main.py */
const NUMBER_RULES = {
  Age: { label: "Age", min: 10, max: 100, integer: true },
  Avg_Daily_Usage_Hours: { label: "Daily usage", min: 0, max: 24 },
  Daily_Unlocks: { label: "Phone unlocks", min: 0, integer: true },
  Study_Hours: { label: "Study time", min: 0, max: 24 },
  Physical_Activity_Hours: { label: "Physical activity", min: 0, max: 24 },
  Sleep_Hours_Per_Night: { label: "Sleep", min: 0, max: 24 },
};
const REQUIRED_CHOICES = {
  Gender: "Choose a gender.",
  Country: "Enter a country.",
  Academic_Level: "Choose an academic level.",
  Most_Used_Platform: "Choose a platform.",
  Purpose_Of_Use: "Choose a purpose.",
  Stress_Level: "Choose a stress level.",
};

const BANDS = {
  good: { title: "Healthy range", advice: "Habits and routine point to a stable outlook. Keep protecting sleep and activity." },
  mid: { title: "Moderate range", advice: "Some signals suggest strain. Small changes to screen time or sleep may help." },
  low: { title: "Needs attention", advice: "The profile suggests a higher risk. Consider talking with a counsellor or someone you trust." },
};

/* ---------- Helpers ---------- */

function readPayload() {
  const data = {};
  for (const [key, value] of new FormData(form).entries()) data[key] = String(value).trim();
  for (const key of Object.keys(NUMBER_RULES)) {
    data[key] = data[key] === "" || data[key] === undefined ? null : Number(data[key]);
  }
  return data;
}

function validate(data) {
  const errors = {};
  for (const [key, message] of Object.entries(REQUIRED_CHOICES)) {
    if (!data[key]) errors[key] = message;
  }
  for (const [key, rule] of Object.entries(NUMBER_RULES)) {
    const value = data[key];
    if (value === null || Number.isNaN(value)) errors[key] = `Enter ${rule.label.toLowerCase()}.`;
    else if (rule.integer && !Number.isInteger(value)) errors[key] = "Use a whole number.";
    else if (rule.min !== undefined && value < rule.min) errors[key] = `Must be at least ${rule.min}.`;
    else if (rule.max !== undefined && value > rule.max) errors[key] = `Must be ${rule.max} or less.`;
  }
  return errors;
}

function showFieldError(name, message) {
  const slot = form.querySelector(`[data-error-for="${name}"]`);
  if (!slot) return false;
  slot.textContent = message;
  slot.closest(".field").classList.add("invalid");
  return true;
}

function clearErrors() {
  banner.hidden = true;
  banner.innerHTML = "";
  form.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".field.invalid").forEach((el) => el.classList.remove("invalid"));
}

function showBanner(title, details = []) {
  banner.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = title;
  banner.append(strong);
  if (details.length) {
    const list = document.createElement("ul");
    details.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.append(li);
    });
    banner.append(list);
  }
  banner.hidden = false;
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("loading", isLoading);
  btnText.textContent = isLoading ? "Predicting…" : "Predict score";
  if (isLoading) result.dataset.state = "loading";
}

/* ---------- API ---------- */

async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw { status: response.status, body };
    return body;
  } catch (err) {
    if (err && err.status) throw err;
    if (err && err.name === "AbortError") throw { status: 0, timeout: true };
    throw { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function handleApiError(err) {
  result.dataset.state = "empty";

  if (err.timeout) {
    return showBanner("The request timed out.", ["The server took too long to respond. Try again."]);
  }
  if (err.status === 0) {
    return showBanner("Cannot reach the API.", [`Check that the backend is running at ${API_URL.replace("/predict", "")}.`]);
  }
  if (err.status === 422 && Array.isArray(err.body?.detail)) {
    const unplaced = [];
    err.body.detail.forEach((item) => {
      const field = item.loc?.[item.loc.length - 1];
      if (!showFieldError(field, item.msg)) unplaced.push(`${field ?? "Input"}: ${item.msg}`);
    });
    return showBanner("Some values were rejected by the server.", unplaced);
  }
  if (err.status >= 500) {
    return showBanner("The server hit an error.", ["Check the uvicorn terminal for the traceback, then try again."]);
  }
  const detail = typeof err.body?.detail === "string" ? err.body.detail : `Request failed with status ${err.status}.`;
  showBanner("The request failed.", [detail]);
}

/* ---------- Result card ---------- */

function bandFor(score) {
  const ratio = score / MAX_SCORE;
  return ratio >= 0.75 ? "good" : ratio >= 0.6 ? "mid" : "low";
}

function showResult(score) {
  const clamped = Math.min(Math.max(score, 0), MAX_SCORE);
  const band = bandFor(score);

  result.dataset.band = band;
  result.dataset.state = "done";
  bandEl.textContent = BANDS[band].title;
  adviceEl.textContent = BANDS[band].advice;

  ring.style.strokeDashoffset = RING_LENGTH;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.strokeDashoffset = RING_LENGTH * (1 - clamped / MAX_SCORE);
  }));

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    scoreEl.textContent = score.toFixed(1);
    return;
  }
  const start = performance.now();
  const duration = 1000;
  (function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    scoreEl.textContent = (score * (1 - Math.pow(1 - t, 3))).toFixed(1);
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

/* ---------- Events ---------- */

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();

  const payload = readPayload();
  const errors = validate(payload);
  const names = Object.keys(errors);
  if (names.length) {
    names.forEach((name) => showFieldError(name, errors[name]));
    showBanner("Please fix the highlighted fields.");
    form.querySelector(".field.invalid")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  setLoading(true);
  try {
    const data = await requestPrediction(payload);
    showResult(Number(data.predicted_mental_health_score));
  } catch (err) {
    handleApiError(err);
  } finally {
    setLoading(false);
  }
});

form.addEventListener("reset", () => {
  clearErrors();
  result.dataset.state = "empty";
  // Let the browser restore default values first, then re-sync the sliders.
  setTimeout(() => form.querySelectorAll("[data-sync]").forEach((r) => (r.value = document.getElementById(r.dataset.sync).value)), 0);
});

/* Keep each slider and its number box in sync */
form.querySelectorAll("[data-sync]").forEach((range) => {
  const number = document.getElementById(range.dataset.sync);
  range.addEventListener("input", () => (number.value = range.value));
  number.addEventListener("input", () => { if (number.value !== "") range.value = number.value; });
});

/* Clear a field's error as soon as the person edits it */
form.addEventListener("input", (event) => {
  const field = event.target.closest(".field");
  if (!field?.classList.contains("invalid")) return;
  field.classList.remove("invalid");
  const slot = field.querySelector(".error");
  if (slot) slot.textContent = "";
});
