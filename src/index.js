
"use strict";

const API_BASE = "https://study-ai.egyptianshops1.workers.dev";
const CHUNK_SIZE = 8 * 1024 * 1024;

const $ = (selector) => document.querySelector(selector);

const videoInput = $("#videoFile");
const dropzone = $("#dropzone");
const analyzeBtn = $("#analyzeBtn");
const statusBox = $("#status");
const fileInfo = $("#fileInfo");

let selectedFile = null;
let currentResults = null;
let selectionId = 0;

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

function resetFile() {
  selectionId++;
  selectedFile = null;
  videoInput.value = "";
  fileInfo.classList.add("hidden");
  $("#fileTitle").textContent = "اضغط لاختيار الفيديو";
  $("#fileDescription").textContent = "أو اسحب الملف وأفلته هنا";
  analyzeBtn.disabled = true;
  hideStatus();
}

function selectFile(file) {
  if (!file) return;

  if (!file.type.startsWith("video/")) {
    showStatus("الملف المختار ليس فيديو صالحًا.", "error");
    return;
  }

  if (file.size <= 0 || file.size > 2 * 1024 * 1024 * 1024) {
    showStatus("حجم الفيديو غير صالح أو أكبر من 2 جيجابايت.", "error");
    return;
  }

  selectionId++;
  const thisSelection = selectionId;
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
    if (thisSelection !== selectionId) return;

    if (!Number.isFinite(video.duration)) {
      showStatus("تعذّر قراءة مدة الفيديو. جرّب ملفًا آخر.", "error");
      selectedFile = null;
      analyzeBtn.disabled = true;
      return;
    }

    if (video.duration > 3600) {
      selectedFile = null;
      analyzeBtn.disabled = true;
      showStatus("مدة الفيديو أطول من 60 دقيقة.", "error");
      return;
    }

    const minutes = Math.floor(video.duration / 60);
    const seconds = Math.floor(video.duration % 60);

    $("#selectedSize").textContent =
      `${formatSize(file.size)} • المدة ${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  video.onerror = () => {
    URL.revokeObjectURL(objectUrl);
  };

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

async function apiJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`رد الخادم غير صالح (HTTP ${response.status}).`);
  }

  if (!response.ok || data.error) {
    throw new Error(data.error || `خطأ من الخادم: ${response.status}`);
  }

  return data;
}

async function uploadVideo(file) {
  showStatus("جاري بدء رفع الفيديو...", "info");

  const session = await apiJson("/upload/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      mimeType: file.type
    })
  });

  if (!session.uploadUrl) {
    throw new Error("الخادم لم يُرجع رابط رفع الفيديو.");
  }

  let offset = 0;
  let uploadedFile = null;

  while (offset < file.size) {
    const end = Math.min(offset + (session.chunkSize || CHUNK_SIZE), file.size);
    const chunk = file.slice(offset, end);
    const isLast = end === file.size;

    showStatus(
      `جاري رفع الفيديو... ${Math.floor((offset / file.size) * 100)}٪`,
      "info"
    );

    const response = await fetch(`${API_BASE}/upload/chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Upload-Url": session.uploadUrl,
        "X-Upload-Offset": String(offset),
        "X-Upload-Finalize": String(isLast)
      },
      body: chunk
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`تعذّر رفع جزء من الفيديو (HTTP ${response.status}).`);
    }

    if (!response.ok || data.error) {
      throw new Error(data.error || "فشل رفع جزء من الفيديو.");
    }

    offset = end;
    if (data.file) uploadedFile = data.file;
  }

  if (!uploadedFile?.uri) {
    throw new Error(
      "انتهى رفع الفيديو لكن لم يصل عنوان الملف من Gemini. راجع استجابة الرفع في الخادم."
    );
  }

  return uploadedFile;
}

async function waitUntilReady(file) {
  const match = String(file.name || "").match(/^files\/[A-Za-z0-9_-]+$/);

  if (!match) {
    throw new Error("Gemini لم يُرجع اسم ملف صالحًا للتحقق من التجهيز.");
  }

  for (let attempt = 0; attempt < 60; attempt++) {
    showStatus("تم الرفع. جاري تجهيز الفيديو للتحليل...", "info");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${file.name}`,
      { headers: { "x-goog-api-key": "" } }
    );

    // لا نستخدم طلبًا مباشرًا بمفتاح فارغ؛ التجهيز يجب أن يتم عبر الخادم.
    if (!response.ok) {
      break;
    }

    const current = await response.json();

    if (current.state === "ACTIVE") return current;
    if (current.state === "FAILED") {
      throw new Error("Gemini لم يتمكن من تجهيز الفيديو للتحليل.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(
    "انتهى وقت انتظار تجهيز الفيديو. يجب إضافة مسار فحص حالة الملف في الخادم."
  );
}

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile) {
    showStatus("اختار فيديو الأول.", "error");
    return;
  }

  const file = selectedFile;
  const thisSelection = selectionId;

  analyzeBtn.disabled = true;

  try {
    showStatus("بنتحقق من اتصال الخادم...", "info");

    const health = await apiJson("/health");

    if (!health.ok || !health.keyConfigured) {
      throw new Error("الخادم أو مفتاح Gemini غير جاهز.");
    }

    const uploadedFile = await uploadVideo(file);

    if (thisSelection !== selectionId) return;

    // يتطلب أن تكون حالة الملف ACTIVE قبل استدعاء /analyze.
    // سنضيف فحص الحالة داخل الخادم لضمان عدم كشف المفتاح للمتصفح.
    showStatus("تم رفع الفيديو. جاري طلب التحليل...", "info");

    const data = await apiJson("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileUri: uploadedFile.uri,
        mimeType: uploadedFile.mimeType || file.type
      })
    });

    if (thisSelection !== selectionId) return;

    if (!data.summary || !Array.isArray(data.keyPoints) ||
        !data.article || !Array.isArray(data.quiz)) {
      throw new Error("نتيجة التحليل ناقصة أو غير صالحة.");
    }

    renderResults(data);
    showStatus("اكتمل تحليل الفيديو بنجاح!", "success");
  } catch (err) {
    console.error("StudyAI error:", err);
    showStatus(
      `تعذّر إكمال التحليل: ${err.message || "خطأ غير معروف"}`,
      "error"
    );
  } finally {
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
    showStatus("استجابة التحليل غير مكتملة أو غير صحيحة.", "error");
    return;
  }

  currentResults = data;
  $("#resultTitle").textContent = data.title || "محتواك الدراسي";
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

    const feedback = document.createElement("div");
    feedback.className = "question-feedback";
    feedback.hidden = true;

    (question.options || []).forEach((option, optionIndex) => {
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

    card.appendChild(feedback);
    form.appendChild(card);
  });
}

$("#gradeQuiz").addEventListener("click", () => {
  if (!currentResults?.quiz?.length) {
    showStatus("لا توجد أسئلة جاهزة للتصحيح.", "error");
    return;
  }

  const questions = currentResults.quiz;
  let score = 0;

  for (let index = 0; index < questions.length; index++) {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    if (!card.querySelector(`input[name="question-${index}"]:checked`)) {
      showStatus("جاوب عن كل الأسئلة قبل التصحيح.", "error");
      return;
    }
  }

  questions.forEach((question, index) => {
    const card = $("#quizForm").querySelector(`[data-index="${index}"]`);
    const selected = card.querySelector(`input[name="question-${index}"]:checked`);
    const feedback = card.querySelector(".question-feedback");
    const selectedIndex = Number(selected.value);
    const correctIndex = question.answerIndex;
    const labels = card.querySelectorAll(".answer-option");

    labels.forEach((label) => label.classList.remove("correct", "incorrect"));
    labels[correctIndex]?.classList.add("correct");

    if (selectedIndex === correctIndex) score++;
    else labels[selectedIndex]?.classList.add("incorrect");

    feedback.textContent =
      `الإجابة الصحيحة: ${question.options[correctIndex]}` +
      (question.explanation ? ` — ${question.explanation}` : "");
    feedback.hidden = false;

    card.querySelectorAll("input").forEach((input) => {
      input.disabled = true;
    });
  });

  $("#quizScore").textContent =
    `نتيجتك: ${score} من ${questions.length} (${Math.round(score / questions.length * 100)}٪)`;

  $("#quizScore").classList.remove("hidden");
  $("#gradeQuiz").classList.add("hidden");
  $("#retryQuiz").classList.remove("hidden");
});

$("#retryQuiz").addEventListener("click", () => {
  if (currentResults) renderQuiz(currentResults.quiz);
});

$("#downloadPdf").addEventListener("click", () => window.print());

window.StudyAI = { renderResults };
