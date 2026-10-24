
"use strict";

const API_BASE = "https://study-ai.egyptianshops1.workers.dev";
const $ = (selector) => document.querySelector(selector);

const videoInput = $("#videoFile");
const dropzone = $("#dropzone");
const analyzeBtn = $("#analyzeBtn");
const statusBox = $("#status");
const fileInfo = $("#fileInfo");

const CHUNK_SIZE = 8 * 1024 * 1024;

let selectedFile = null;
let currentResults = null;
let isBusy = false;

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} كيلوبايت`
    : `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

function showStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function hideStatus() {
  statusBox.textContent = "";
  statusBox.className = "status hidden";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("الخادم رجّع استجابة غير مفهومة.");
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.details || data.error || `خطأ من الخادم (${response.status})`
    );
  }

  return data;
}

function resetFile() {
  if (isBusy) return;

  selectedFile = null;
  videoInput.value = "";
  fileInfo.classList.add("hidden");
  $("#fileTitle").textContent = "اضغط لاختيار الفيديو";
  $("#fileDescription").textContent = "أو اسحب الملف وأفلته هنا";
  analyzeBtn.disabled = true;
  hideStatus();
}

function selectFile(file) {
  if (!file || isBusy) return;

  if (!file.type.startsWith("video/")) {
    showStatus("الملف المختار ليس فيديو صالحًا.", "error");
    return;
  }

  if (file.size <= 0) {
    showStatus("ملف الفيديو فارغ.", "error");
    return;
  }

  selectedFile = file;

  $("#fileTitle").textContent = "تم اختيار الفيديو";
  $("#fileDescription").textContent = "يمكنك تغييره قبل بدء التحليل";
  $("#selectedName").textContent = file.name;
  $("#selectedSize").textContent = formatSize(file.size);

  fileInfo.classList.remove("hidden");
  analyzeBtn.disabled = false;
  hideStatus();

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";

  video.onloadedmetadata = () => {
    URL.revokeObjectURL(objectUrl);

    if (Number.isFinite(video.duration) && video.duration > 3600) {
      showStatus("مدة الفيديو أطول من 60 دقيقة.", "error");
      selectedFile = null;
      analyzeBtn.disabled = true;
      return;
    }

    if (Number.isFinite(video.duration)) {
      const minutes = Math.floor(video.duration / 60);
      const seconds = Math.floor(video.duration % 60);

      $("#selectedSize").textContent =
        `${formatSize(file.size)} • المدة ${minutes}:${String(seconds).padStart(2, "0")}`;
    }
  };

  video.onerror = () => URL.revokeObjectURL(objectUrl);
  video.src = objectUrl;
}

videoInput.addEventListener("change", () => {
  selectFile(videoInput.files[0]);
});

$("#removeFile").addEventListener("click", resetFile);

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  selectFile(event.dataTransfer.files[0]);
});

async function uploadVideo(file) {
  showStatus("1/3 — بنجهّز رفع الفيديو إلى Gemini...", "info");

  const session = await requestJson(`${API_BASE}/upload-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: file.size,
      mimeType: file.type || "video/mp4",
      name: file.name
    })
  });

  if (!session.uploadUrl) {
    throw new Error("الخادم لم يُرجع رابط رفع الفيديو.");
  }

  let finalFile = null;
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const isFinal = end === file.size;

    showStatus(
      `1/3 — جاري رفع الفيديو: ${Math.floor((end / file.size) * 100)}٪`,
      "info"
    );

    const result = await requestJson(`${API_BASE}/upload-chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Upload-Url": session.uploadUrl,
        "X-Upload-Offset": String(offset),
        "X-Upload-Final": String(isFinal)
      },
      body: chunk
    });

    if (isFinal) finalFile = result.file;
    offset = end;
  }

  if (!finalFile || !finalFile.uri) {
    throw new Error(
      "تم إرسال الفيديو، لكن الخادم لم يُرجع رابط الملف من Gemini."
    );
  }

  return {
    fileUri: finalFile.uri,
    mimeType: finalFile.mimeType || file.type || "video/mp4",
    fileName: finalFile.name || ""
  };
}

async function analyzeVideo(fileInfo) {
  showStatus(
    "2/3 — تم رفع الفيديو. بنطلب من Gemini إنشاء الملخص والمقال والأسئلة...",
    "info"
  );

  const result = await requestJson(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileUri: fileInfo.fileUri,
      mimeType: fileInfo.mimeType,
      language: "ar"
    })
  });

  if (!result.study) {
    throw new Error("Gemini لم يُرجع نتائج الدراسة بالشكل المتوقع.");
  }

  return result.study;
}

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile || isBusy) {
    if (!selectedFile) showStatus("اختار فيديو الأول.", "error");
    return;
  }

  isBusy = true;
  analyzeBtn.disabled = true;

  try {
    const fileInfo = await uploadVideo(selectedFile);
    const study = await analyzeVideo(fileInfo);

    showStatus("3/3 — اكتمل التحليل بنجاح!", "success");
    renderResults(study);
  } catch (error) {
    console.error("StudyAI error:", error);
    showStatus(
      `تعذر إكمال العملية: ${error.message || "خطأ غير معروف"}`,
      "error"
    );
  } finally {
    isBusy = false;
    analyzeBtn.disabled = !selectedFile;
  }
});

function renderResults(data) {
  if (
    !data ||
    typeof data.summary !== "string" ||
    !Array.isArray(data.keyPoints) ||
    typeof data.article !== "string" ||
    !Array.isArray(data.quiz)
  ) {
    showStatus("نتيجة التحليل ناقصة أو غير صالحة.", "error");
    return;
  }

  currentResults = data;

  $("#resultTitle").textContent =
    typeof data.title === "string" && data.title.trim()
      ? data.title
      : "محتواك الدراسي";

  $("#summary").textContent = data.summary;
  $("#article").textContent = data.article;

  const pointsList = $("#keyPoints");
  pointsList.replaceChildren();

  data.keyPoints.forEach((point) => {
    const item = document.createElement("li");
    item.textContent = String(point);
    pointsList.appendChild(item);
  });

  renderQuiz(data.quiz);

  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderQuiz(questions) {
  const form = $("#quizForm");
  form.replaceChildren();

  $("#quizCount").textContent = `${questions.length} أسئلة`;
  $("#quizScore").classList.add("hidden");
  $("#retryQuiz").classList.add("hidden");
  $("#gradeQuiz").classList.remove("hidden");

  questions.forEach((question, index) => {
    const card = document.createElement("section");
    card.className = "question";
    card.dataset.index = String(index);

    const heading = document.createElement("h4");
    heading.textContent = `${index + 1}. ${question.question}`;
    card.appendChild(heading);

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "answer-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `question-${index}`;
      radio.value = String(optionIndex);
      radio.required = true;

      const text = document.createElement("span");
      text.textContent = String(option);

      label.append(radio, text);
      card.appendChild(label);
    });

    const feedback = document.createElement("div");
    feedback.className = "question-feedback";
    feedback.hidden = true;
    card.appendChild(feedback);

    form.appendChild(card);
  });
}

$("#gradeQuiz").addEventListener("click", () => {
  if (!currentResults || !currentResults.quiz.length) {
    showStatus("لا توجد أسئلة جاهزة للتصحيح.", "error");
    return;
  }

  const questions = currentResults.quiz;
  let score = 0;

  for (let index = 0; index < questions.length; index++) {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );

    if (!selected) {
      showStatus("جاوب عن كل الأسئلة قبل التصحيح.", "error");
      return;
    }
  }

  questions.forEach((question, index) => {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );
    const feedback = card.querySelector(".question-feedback");
    const labels = card.querySelectorAll(".answer-option");
    const selectedIndex = Number(selected.value);
    const correctIndex = question.answerIndex;

    labels.forEach((label) =>
      label.classList.remove("correct", "incorrect")
    );

    labels[correctIndex]?.classList.add("correct");

    if (selectedIndex === correctIndex) {
      score++;
    } else {
      labels[selectedIndex]?.classList.add("incorrect");
    }

    feedback.textContent =
      `الإجابة الصحيحة: ${question.options[correctIndex]}` +
      (question.explanation ? ` — ${question.explanation}` : "");
    feedback.hidden = false;

    card.querySelectorAll("input").forEach((input) => {
      input.disabled = true;
    });
  });

  $("#quizScore").textContent =
    `نتيجتك: ${score} من ${questions.length} (${Math.round(
      (score / questions.length) * 100
    )}٪)`;

  $("#quizScore").classList.remove("hidden");
  $("#gradeQuiz").classList.add("hidden");
  $("#retryQuiz").classList.remove("hidden");
});

$("#retryQuiz").addEventListener("click", () => {
  if (currentResults) renderQuiz(currentResults.quiz);
});

$("#downloadPdf").addEventListener("click", () => {
  window.print();
});

window.StudyAI = { renderResults };

"use strict";

const API_BASE = "https://study-ai.egyptianshops1.workers.dev";
const $ = (selector) => document.querySelector(selector);

const videoInput = $("#videoFile");
const dropzone = $("#dropzone");
const analyzeBtn = $("#analyzeBtn");
const statusBox = $("#status");
const fileInfo = $("#fileInfo");

const CHUNK_SIZE = 8 * 1024 * 1024;

let selectedFile = null;
let currentResults = null;
let isBusy = false;

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} كيلوبايت`
    : `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

function showStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function hideStatus() {
  statusBox.textContent = "";
  statusBox.className = "status hidden";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("الخادم رجّع استجابة غير مفهومة.");
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.details || data.error || `خطأ من الخادم (${response.status})`
    );
  }

  return data;
}

function resetFile() {
  if (isBusy) return;

  selectedFile = null;
  videoInput.value = "";
  fileInfo.classList.add("hidden");
  $("#fileTitle").textContent = "اضغط لاختيار الفيديو";
  $("#fileDescription").textContent = "أو اسحب الملف وأفلته هنا";
  analyzeBtn.disabled = true;
  hideStatus();
}

function selectFile(file) {
  if (!file || isBusy) return;

  if (!file.type.startsWith("video/")) {
    showStatus("الملف المختار ليس فيديو صالحًا.", "error");
    return;
  }

  if (file.size <= 0) {
    showStatus("ملف الفيديو فارغ.", "error");
    return;
  }

  selectedFile = file;

  $("#fileTitle").textContent = "تم اختيار الفيديو";
  $("#fileDescription").textContent = "يمكنك تغييره قبل بدء التحليل";
  $("#selectedName").textContent = file.name;
  $("#selectedSize").textContent = formatSize(file.size);

  fileInfo.classList.remove("hidden");
  analyzeBtn.disabled = false;
  hideStatus();

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";

  video.onloadedmetadata = () => {
    URL.revokeObjectURL(objectUrl);

    if (Number.isFinite(video.duration) && video.duration > 3600) {
      showStatus("مدة الفيديو أطول من 60 دقيقة.", "error");
      selectedFile = null;
      analyzeBtn.disabled = true;
      return;
    }

    if (Number.isFinite(video.duration)) {
      const minutes = Math.floor(video.duration / 60);
      const seconds = Math.floor(video.duration % 60);

      $("#selectedSize").textContent =
        `${formatSize(file.size)} • المدة ${minutes}:${String(seconds).padStart(2, "0")}`;
    }
  };

  video.onerror = () => URL.revokeObjectURL(objectUrl);
  video.src = objectUrl;
}

videoInput.addEventListener("change", () => {
  selectFile(videoInput.files[0]);
});

$("#removeFile").addEventListener("click", resetFile);

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  selectFile(event.dataTransfer.files[0]);
});

async function uploadVideo(file) {
  showStatus("1/3 — بنجهّز رفع الفيديو إلى Gemini...", "info");

  const session = await requestJson(`${API_BASE}/upload-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: file.size,
      mimeType: file.type || "video/mp4",
      name: file.name
    })
  });

  if (!session.uploadUrl) {
    throw new Error("الخادم لم يُرجع رابط رفع الفيديو.");
  }

  let finalFile = null;
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const isFinal = end === file.size;

    showStatus(
      `1/3 — جاري رفع الفيديو: ${Math.floor((end / file.size) * 100)}٪`,
      "info"
    );

    const result = await requestJson(`${API_BASE}/upload-chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Upload-Url": session.uploadUrl,
        "X-Upload-Offset": String(offset),
        "X-Upload-Final": String(isFinal)
      },
      body: chunk
    });

    if (isFinal) finalFile = result.file;
    offset = end;
  }

  if (!finalFile || !finalFile.uri) {
    throw new Error(
      "تم إرسال الفيديو، لكن الخادم لم يُرجع رابط الملف من Gemini."
    );
  }

  return {
    fileUri: finalFile.uri,
    mimeType: finalFile.mimeType || file.type || "video/mp4",
    fileName: finalFile.name || ""
  };
}

async function analyzeVideo(fileInfo) {
  showStatus(
    "2/3 — تم رفع الفيديو. بنطلب من Gemini إنشاء الملخص والمقال والأسئلة...",
    "info"
  );

  const result = await requestJson(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileUri: fileInfo.fileUri,
      mimeType: fileInfo.mimeType,
      language: "ar"
    })
  });

  if (!result.study) {
    throw new Error("Gemini لم يُرجع نتائج الدراسة بالشكل المتوقع.");
  }

  return result.study;
}

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile || isBusy) {
    if (!selectedFile) showStatus("اختار فيديو الأول.", "error");
    return;
  }

  isBusy = true;
  analyzeBtn.disabled = true;

  try {
    const fileInfo = await uploadVideo(selectedFile);
    const study = await analyzeVideo(fileInfo);

    showStatus("3/3 — اكتمل التحليل بنجاح!", "success");
    renderResults(study);
  } catch (error) {
    console.error("StudyAI error:", error);
    showStatus(
      `تعذر إكمال العملية: ${error.message || "خطأ غير معروف"}`,
      "error"
    );
  } finally {
    isBusy = false;
    analyzeBtn.disabled = !selectedFile;
  }
});

function renderResults(data) {
  if (
    !data ||
    typeof data.summary !== "string" ||
    !Array.isArray(data.keyPoints) ||
    typeof data.article !== "string" ||
    !Array.isArray(data.quiz)
  ) {
    showStatus("نتيجة التحليل ناقصة أو غير صالحة.", "error");
    return;
  }

  currentResults = data;

  $("#resultTitle").textContent =
    typeof data.title === "string" && data.title.trim()
      ? data.title
      : "محتواك الدراسي";

  $("#summary").textContent = data.summary;
  $("#article").textContent = data.article;

  const pointsList = $("#keyPoints");
  pointsList.replaceChildren();

  data.keyPoints.forEach((point) => {
    const item = document.createElement("li");
    item.textContent = String(point);
    pointsList.appendChild(item);
  });

  renderQuiz(data.quiz);

  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderQuiz(questions) {
  const form = $("#quizForm");
  form.replaceChildren();

  $("#quizCount").textContent = `${questions.length} أسئلة`;
  $("#quizScore").classList.add("hidden");
  $("#retryQuiz").classList.add("hidden");
  $("#gradeQuiz").classList.remove("hidden");

  questions.forEach((question, index) => {
    const card = document.createElement("section");
    card.className = "question";
    card.dataset.index = String(index);

    const heading = document.createElement("h4");
    heading.textContent = `${index + 1}. ${question.question}`;
    card.appendChild(heading);

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "answer-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `question-${index}`;
      radio.value = String(optionIndex);
      radio.required = true;

      const text = document.createElement("span");
      text.textContent = String(option);

      label.append(radio, text);
      card.appendChild(label);
    });

    const feedback = document.createElement("div");
    feedback.className = "question-feedback";
    feedback.hidden = true;
    card.appendChild(feedback);

    form.appendChild(card);
  });
}

$("#gradeQuiz").addEventListener("click", () => {
  if (!currentResults || !currentResults.quiz.length) {
    showStatus("لا توجد أسئلة جاهزة للتصحيح.", "error");
    return;
  }

  const questions = currentResults.quiz;
  let score = 0;

  for (let index = 0; index < questions.length; index++) {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );

    if (!selected) {
      showStatus("جاوب عن كل الأسئلة قبل التصحيح.", "error");
      return;
    }
  }

  questions.forEach((question, index) => {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );
    const feedback = card.querySelector(".question-feedback");
    const labels = card.querySelectorAll(".answer-option");
    const selectedIndex = Number(selected.value);
    const correctIndex = question.answerIndex;

    labels.forEach((label) =>
      label.classList.remove("correct", "incorrect")
    );

    labels[correctIndex]?.classList.add("correct");

    if (selectedIndex === correctIndex) {
      score++;
    } else {
      labels[selectedIndex]?.classList.add("incorrect");
    }

    feedback.textContent =
      `الإجابة الصحيحة: ${question.options[correctIndex]}` +
      (question.explanation ? ` — ${question.explanation}` : "");
    feedback.hidden = false;

    card.querySelectorAll("input").forEach((input) => {
      input.disabled = true;
    });
  });

  $("#quizScore").textContent =
    `نتيجتك: ${score} من ${questions.length} (${Math.round(
      (score / questions.length) * 100
    )}٪)`;

  $("#quizScore").classList.remove("hidden");
  $("#gradeQuiz").classList.add("hidden");
  $("#retryQuiz").classList.remove("hidden");
});

$("#retryQuiz").addEventListener("click", () => {
  if (currentResults) renderQuiz(currentResults.quiz);
});

$("#downloadPdf").addEventListener("click", () => {
  window.print();
});

window.StudyAI = { renderResults };

"use strict";

const API_BASE = "https://study-ai.egyptianshops1.workers.dev";
const $ = (selector) => document.querySelector(selector);

const videoInput = $("#videoFile");
const dropzone = $("#dropzone");
const analyzeBtn = $("#analyzeBtn");
const statusBox = $("#status");
const fileInfo = $("#fileInfo");

const CHUNK_SIZE = 8 * 1024 * 1024;

let selectedFile = null;
let currentResults = null;
let isBusy = false;

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} كيلوبايت`
    : `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

function showStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function hideStatus() {
  statusBox.textContent = "";
  statusBox.className = "status hidden";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("الخادم رجّع استجابة غير مفهومة.");
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.details || data.error || `خطأ من الخادم (${response.status})`
    );
  }

  return data;
}

function resetFile() {
  if (isBusy) return;

  selectedFile = null;
  videoInput.value = "";
  fileInfo.classList.add("hidden");
  $("#fileTitle").textContent = "اضغط لاختيار الفيديو";
  $("#fileDescription").textContent = "أو اسحب الملف وأفلته هنا";
  analyzeBtn.disabled = true;
  hideStatus();
}

function selectFile(file) {
  if (!file || isBusy) return;

  if (!file.type.startsWith("video/")) {
    showStatus("الملف المختار ليس فيديو صالحًا.", "error");
    return;
  }

  if (file.size <= 0) {
    showStatus("ملف الفيديو فارغ.", "error");
    return;
  }

  selectedFile = file;

  $("#fileTitle").textContent = "تم اختيار الفيديو";
  $("#fileDescription").textContent = "يمكنك تغييره قبل بدء التحليل";
  $("#selectedName").textContent = file.name;
  $("#selectedSize").textContent = formatSize(file.size);

  fileInfo.classList.remove("hidden");
  analyzeBtn.disabled = false;
  hideStatus();

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";

  video.onloadedmetadata = () => {
    URL.revokeObjectURL(objectUrl);

    if (Number.isFinite(video.duration) && video.duration > 3600) {
      showStatus("مدة الفيديو أطول من 60 دقيقة.", "error");
      selectedFile = null;
      analyzeBtn.disabled = true;
      return;
    }

    if (Number.isFinite(video.duration)) {
      const minutes = Math.floor(video.duration / 60);
      const seconds = Math.floor(video.duration % 60);

      $("#selectedSize").textContent =
        `${formatSize(file.size)} • المدة ${minutes}:${String(seconds).padStart(2, "0")}`;
    }
  };

  video.onerror = () => URL.revokeObjectURL(objectUrl);
  video.src = objectUrl;
}

videoInput.addEventListener("change", () => {
  selectFile(videoInput.files[0]);
});

$("#removeFile").addEventListener("click", resetFile);

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  selectFile(event.dataTransfer.files[0]);
});

async function uploadVideo(file) {
  showStatus("1/3 — بنجهّز رفع الفيديو إلى Gemini...", "info");

  const session = await requestJson(`${API_BASE}/upload-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: file.size,
      mimeType: file.type || "video/mp4",
      name: file.name
    })
  });

  if (!session.uploadUrl) {
    throw new Error("الخادم لم يُرجع رابط رفع الفيديو.");
  }

  let finalFile = null;
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const isFinal = end === file.size;

    showStatus(
      `1/3 — جاري رفع الفيديو: ${Math.floor((end / file.size) * 100)}٪`,
      "info"
    );

    const result = await requestJson(`${API_BASE}/upload-chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Upload-Url": session.uploadUrl,
        "X-Upload-Offset": String(offset),
        "X-Upload-Final": String(isFinal)
      },
      body: chunk
    });

    if (isFinal) finalFile = result.file;
    offset = end;
  }

  if (!finalFile || !finalFile.uri) {
    throw new Error(
      "تم إرسال الفيديو، لكن الخادم لم يُرجع رابط الملف من Gemini."
    );
  }

  return {
    fileUri: finalFile.uri,
    mimeType: finalFile.mimeType || file.type || "video/mp4",
    fileName: finalFile.name || ""
  };
}

async function analyzeVideo(fileInfo) {
  showStatus(
    "2/3 — تم رفع الفيديو. بنطلب من Gemini إنشاء الملخص والمقال والأسئلة...",
    "info"
  );

  const result = await requestJson(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileUri: fileInfo.fileUri,
      mimeType: fileInfo.mimeType,
      language: "ar"
    })
  });

  if (!result.study) {
    throw new Error("Gemini لم يُرجع نتائج الدراسة بالشكل المتوقع.");
  }

  return result.study;
}

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile || isBusy) {
    if (!selectedFile) showStatus("اختار فيديو الأول.", "error");
    return;
  }

  isBusy = true;
  analyzeBtn.disabled = true;

  try {
    const fileInfo = await uploadVideo(selectedFile);
    const study = await analyzeVideo(fileInfo);

    showStatus("3/3 — اكتمل التحليل بنجاح!", "success");
    renderResults(study);
  } catch (error) {
    console.error("StudyAI error:", error);
    showStatus(
      `تعذر إكمال العملية: ${error.message || "خطأ غير معروف"}`,
      "error"
    );
  } finally {
    isBusy = false;
    analyzeBtn.disabled = !selectedFile;
  }
});

function renderResults(data) {
  if (
    !data ||
    typeof data.summary !== "string" ||
    !Array.isArray(data.keyPoints) ||
    typeof data.article !== "string" ||
    !Array.isArray(data.quiz)
  ) {
    showStatus("نتيجة التحليل ناقصة أو غير صالحة.", "error");
    return;
  }

  currentResults = data;

  $("#resultTitle").textContent =
    typeof data.title === "string" && data.title.trim()
      ? data.title
      : "محتواك الدراسي";

  $("#summary").textContent = data.summary;
  $("#article").textContent = data.article;

  const pointsList = $("#keyPoints");
  pointsList.replaceChildren();

  data.keyPoints.forEach((point) => {
    const item = document.createElement("li");
    item.textContent = String(point);
    pointsList.appendChild(item);
  });

  renderQuiz(data.quiz);

  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderQuiz(questions) {
  const form = $("#quizForm");
  form.replaceChildren();

  $("#quizCount").textContent = `${questions.length} أسئلة`;
  $("#quizScore").classList.add("hidden");
  $("#retryQuiz").classList.add("hidden");
  $("#gradeQuiz").classList.remove("hidden");

  questions.forEach((question, index) => {
    const card = document.createElement("section");
    card.className = "question";
    card.dataset.index = String(index);

    const heading = document.createElement("h4");
    heading.textContent = `${index + 1}. ${question.question}`;
    card.appendChild(heading);

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "answer-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `question-${index}`;
      radio.value = String(optionIndex);
      radio.required = true;

      const text = document.createElement("span");
      text.textContent = String(option);

      label.append(radio, text);
      card.appendChild(label);
    });

    const feedback = document.createElement("div");
    feedback.className = "question-feedback";
    feedback.hidden = true;
    card.appendChild(feedback);

    form.appendChild(card);
  });
}

$("#gradeQuiz").addEventListener("click", () => {
  if (!currentResults || !currentResults.quiz.length) {
    showStatus("لا توجد أسئلة جاهزة للتصحيح.", "error");
    return;
  }

  const questions = currentResults.quiz;
  let score = 0;

  for (let index = 0; index < questions.length; index++) {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );

    if (!selected) {
      showStatus("جاوب عن كل الأسئلة قبل التصحيح.", "error");
      return;
    }
  }

  questions.forEach((question, index) => {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );
    const feedback = card.querySelector(".question-feedback");
    const labels = card.querySelectorAll(".answer-option");
    const selectedIndex = Number(selected.value);
    const correctIndex = question.answerIndex;

    labels.forEach((label) =>
      label.classList.remove("correct", "incorrect")
    );

    labels[correctIndex]?.classList.add("correct");

    if (selectedIndex === correctIndex) {
      score++;
    } else {
      labels[selectedIndex]?.classList.add("incorrect");
    }

    feedback.textContent =
      `الإجابة الصحيحة: ${question.options[correctIndex]}` +
      (question.explanation ? ` — ${question.explanation}` : "");
    feedback.hidden = false;

    card.querySelectorAll("input").forEach((input) => {
      input.disabled = true;
    });
  });

  $("#quizScore").textContent =
    `نتيجتك: ${score} من ${questions.length} (${Math.round(
      (score / questions.length) * 100
    )}٪)`;

  $("#quizScore").classList.remove("hidden");
  $("#gradeQuiz").classList.add("hidden");
  $("#retryQuiz").classList.remove("hidden");
});

$("#retryQuiz").addEventListener("click", () => {
  if (currentResults) renderQuiz(currentResults.quiz);
});

$("#downloadPdf").addEventListener("click", () => {
  window.print();
});

window.StudyAI = { renderResults };

"use strict";

const API_BASE = "https://study-ai.egyptianshops1.workers.dev";
const $ = (selector) => document.querySelector(selector);

const videoInput = $("#videoFile");
const dropzone = $("#dropzone");
const analyzeBtn = $("#analyzeBtn");
const statusBox = $("#status");
const fileInfo = $("#fileInfo");

const CHUNK_SIZE = 8 * 1024 * 1024;

let selectedFile = null;
let currentResults = null;
let isBusy = false;

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} كيلوبايت`
    : `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

function showStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function hideStatus() {
  statusBox.textContent = "";
  statusBox.className = "status hidden";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("الخادم رجّع استجابة غير مفهومة.");
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.details || data.error || `خطأ من الخادم (${response.status})`
    );
  }

  return data;
}

function resetFile() {
  if (isBusy) return;

  selectedFile = null;
  videoInput.value = "";
  fileInfo.classList.add("hidden");
  $("#fileTitle").textContent = "اضغط لاختيار الفيديو";
  $("#fileDescription").textContent = "أو اسحب الملف وأفلته هنا";
  analyzeBtn.disabled = true;
  hideStatus();
}

function selectFile(file) {
  if (!file || isBusy) return;

  if (!file.type.startsWith("video/")) {
    showStatus("الملف المختار ليس فيديو صالحًا.", "error");
    return;
  }

  if (file.size <= 0) {
    showStatus("ملف الفيديو فارغ.", "error");
    return;
  }

  selectedFile = file;

  $("#fileTitle").textContent = "تم اختيار الفيديو";
  $("#fileDescription").textContent = "يمكنك تغييره قبل بدء التحليل";
  $("#selectedName").textContent = file.name;
  $("#selectedSize").textContent = formatSize(file.size);

  fileInfo.classList.remove("hidden");
  analyzeBtn.disabled = false;
  hideStatus();

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";

  video.onloadedmetadata = () => {
    URL.revokeObjectURL(objectUrl);

    if (Number.isFinite(video.duration) && video.duration > 3600) {
      showStatus("مدة الفيديو أطول من 60 دقيقة.", "error");
      selectedFile = null;
      analyzeBtn.disabled = true;
      return;
    }

    if (Number.isFinite(video.duration)) {
      const minutes = Math.floor(video.duration / 60);
      const seconds = Math.floor(video.duration % 60);

      $("#selectedSize").textContent =
        `${formatSize(file.size)} • المدة ${minutes}:${String(seconds).padStart(2, "0")}`;
    }
  };

  video.onerror = () => URL.revokeObjectURL(objectUrl);
  video.src = objectUrl;
}

videoInput.addEventListener("change", () => {
  selectFile(videoInput.files[0]);
});

$("#removeFile").addEventListener("click", resetFile);

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  selectFile(event.dataTransfer.files[0]);
});

async function uploadVideo(file) {
  showStatus("1/3 — بنجهّز رفع الفيديو إلى Gemini...", "info");

  const session = await requestJson(`${API_BASE}/upload-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: file.size,
      mimeType: file.type || "video/mp4",
      name: file.name
    })
  });

  if (!session.uploadUrl) {
    throw new Error("الخادم لم يُرجع رابط رفع الفيديو.");
  }

  let finalFile = null;
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const isFinal = end === file.size;

    showStatus(
      `1/3 — جاري رفع الفيديو: ${Math.floor((end / file.size) * 100)}٪`,
      "info"
    );

    const result = await requestJson(`${API_BASE}/upload-chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Upload-Url": session.uploadUrl,
        "X-Upload-Offset": String(offset),
        "X-Upload-Final": String(isFinal)
      },
      body: chunk
    });

    if (isFinal) finalFile = result.file;
    offset = end;
  }

  if (!finalFile || !finalFile.uri) {
    throw new Error(
      "تم إرسال الفيديو، لكن الخادم لم يُرجع رابط الملف من Gemini."
    );
  }

  return {
    fileUri: finalFile.uri,
    mimeType: finalFile.mimeType || file.type || "video/mp4",
    fileName: finalFile.name || ""
  };
}

async function analyzeVideo(fileInfo) {
  showStatus(
    "2/3 — تم رفع الفيديو. بنطلب من Gemini إنشاء الملخص والمقال والأسئلة...",
    "info"
  );

  const result = await requestJson(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileUri: fileInfo.fileUri,
      mimeType: fileInfo.mimeType,
      language: "ar"
    })
  });

  if (!result.study) {
    throw new Error("Gemini لم يُرجع نتائج الدراسة بالشكل المتوقع.");
  }

  return result.study;
}

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile || isBusy) {
    if (!selectedFile) showStatus("اختار فيديو الأول.", "error");
    return;
  }

  isBusy = true;
  analyzeBtn.disabled = true;

  try {
    const fileInfo = await uploadVideo(selectedFile);
    const study = await analyzeVideo(fileInfo);

    showStatus("3/3 — اكتمل التحليل بنجاح!", "success");
    renderResults(study);
  } catch (error) {
    console.error("StudyAI error:", error);
    showStatus(
      `تعذر إكمال العملية: ${error.message || "خطأ غير معروف"}`,
      "error"
    );
  } finally {
    isBusy = false;
    analyzeBtn.disabled = !selectedFile;
  }
});

function renderResults(data) {
  if (
    !data ||
    typeof data.summary !== "string" ||
    !Array.isArray(data.keyPoints) ||
    typeof data.article !== "string" ||
    !Array.isArray(data.quiz)
  ) {
    showStatus("نتيجة التحليل ناقصة أو غير صالحة.", "error");
    return;
  }

  currentResults = data;

  $("#resultTitle").textContent =
    typeof data.title === "string" && data.title.trim()
      ? data.title
      : "محتواك الدراسي";

  $("#summary").textContent = data.summary;
  $("#article").textContent = data.article;

  const pointsList = $("#keyPoints");
  pointsList.replaceChildren();

  data.keyPoints.forEach((point) => {
    const item = document.createElement("li");
    item.textContent = String(point);
    pointsList.appendChild(item);
  });

  renderQuiz(data.quiz);

  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderQuiz(questions) {
  const form = $("#quizForm");
  form.replaceChildren();

  $("#quizCount").textContent = `${questions.length} أسئلة`;
  $("#quizScore").classList.add("hidden");
  $("#retryQuiz").classList.add("hidden");
  $("#gradeQuiz").classList.remove("hidden");

  questions.forEach((question, index) => {
    const card = document.createElement("section");
    card.className = "question";
    card.dataset.index = String(index);

    const heading = document.createElement("h4");
    heading.textContent = `${index + 1}. ${question.question}`;
    card.appendChild(heading);

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "answer-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `question-${index}`;
      radio.value = String(optionIndex);
      radio.required = true;

      const text = document.createElement("span");
      text.textContent = String(option);

      label.append(radio, text);
      card.appendChild(label);
    });

    const feedback = document.createElement("div");
    feedback.className = "question-feedback";
    feedback.hidden = true;
    card.appendChild(feedback);

    form.appendChild(card);
  });
}

$("#gradeQuiz").addEventListener("click", () => {
  if (!currentResults || !currentResults.quiz.length) {
    showStatus("لا توجد أسئلة جاهزة للتصحيح.", "error");
    return;
  }

  const questions = currentResults.quiz;
  let score = 0;

  for (let index = 0; index < questions.length; index++) {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );

    if (!selected) {
      showStatus("جاوب عن كل الأسئلة قبل التصحيح.", "error");
      return;
    }
  }

  questions.forEach((question, index) => {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );
    const feedback = card.querySelector(".question-feedback");
    const labels = card.querySelectorAll(".answer-option");
    const selectedIndex = Number(selected.value);
    const correctIndex = question.answerIndex;

    labels.forEach((label) =>
      label.classList.remove("correct", "incorrect")
    );

    labels[correctIndex]?.classList.add("correct");

    if (selectedIndex === correctIndex) {
      score++;
    } else {
      labels[selectedIndex]?.classList.add("incorrect");
    }

    feedback.textContent =
      `الإجابة الصحيحة: ${question.options[correctIndex]}` +
      (question.explanation ? ` — ${question.explanation}` : "");
    feedback.hidden = false;

    card.querySelectorAll("input").forEach((input) => {
      input.disabled = true;
    });
  });

  $("#quizScore").textContent =
    `نتيجتك: ${score} من ${questions.length} (${Math.round(
      (score / questions.length) * 100
    )}٪)`;

  $("#quizScore").classList.remove("hidden");
  $("#gradeQuiz").classList.add("hidden");
  $("#retryQuiz").classList.remove("hidden");
});

$("#retryQuiz").addEventListener("click", () => {
  if (currentResults) renderQuiz(currentResults.quiz);
});

$("#downloadPdf").addEventListener("click", () => {
  window.print();
});

window.StudyAI = { renderResults };
