
"use strict";

// رابط Cloudflare Worker الخاص بمشروع StudyAI
const API_BASE = "https://study-ai.egyptianshops1.workers.dev";

const $ = (selector) => document.querySelector(selector);

const videoInput = $("#videoFile");
const dropzone = $("#dropzone");
const analyzeBtn = $("#analyzeBtn");
const statusBox = $("#status");
const fileInfo = $("#fileInfo");

let selectedFile = null;
let currentResults = null;

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
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
    showStatus(
      "الملف المختار ليس فيديو. اختار ملف فيديو صالحًا.",
      "error"
    );
    return;
  }

  selectedFile = file;

  $("#fileTitle").textContent = "تم اختيار الفيديو";
  $("#fileDescription").textContent =
    "يمكنك تغييره قبل بدء التحليل";
  $("#selectedName").textContent = file.name;
  $("#selectedSize").textContent = formatSize(file.size);

  fileInfo.classList.remove("hidden");
  analyzeBtn.disabled = false;
  hideStatus();

  // قراءة مدة الفيديو محليًا فقط.
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";

  video.onloadedmetadata = () => {
    const duration = video.duration;
    URL.revokeObjectURL(objectUrl);

    if (Number.isFinite(duration) && duration > 60 * 60) {
      showStatus(
        "مدة الفيديو أطول من 60 دقيقة. اختار فيديو أقصر.",
        "error"
      );
      selectedFile = null;
      analyzeBtn.disabled = true;
      return;
    }

    if (Number.isFinite(duration)) {
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);

      $("#selectedSize").textContent =
        `${formatSize(file.size)} • المدة ${minutes}:${String(
          seconds
        ).padStart(2, "0")}`;
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

  const file = event.dataTransfer.files[0];
  if (!file) return;

  selectFile(file);
});

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile) {
    showStatus("اختار فيديو الأول.", "error");
    return;
  }

  analyzeBtn.disabled = true;
  showStatus("بنتحقق من اتصال خادم StudyAI...", "info");

  try {
    const response = await fetch(`${API_BASE}/health`);

    // قراءة الرد كنص أولًا حتى نعرض الخطأ حتى لو لم يكن JSON.
    const responseText = await response.text();

    let health;

    try {
      health = JSON.parse(responseText);
    } catch {
      throw new Error(
        `الخادم رجع ردًا غير متوقع (HTTP ${response.status}).`
      );
    }

    if (!response.ok) {
      throw new Error(
        `الخادم رجع HTTP ${response.status}: ${
          health.error || health.message || responseText
        }`
      );
    }

    if (!health.ok) {
      throw new Error(
        health.error || health.message || "الخادم غير جاهز."
      );
    }

    showStatus(
      "الاتصال بالخادم ناجح، لكن رفع الفيديو وتحليله لم يتم توصيلهما بعد.",
      "info"
    );
  } catch (error) {
    console.error("StudyAI connection error:", error);

    let message = error.message || "خطأ غير معروف";

    if (
      error instanceof TypeError ||
      /failed to fetch|networkerror/i.test(message)
    ) {
      message =
        "تعذر الاتصال بالخادم. قد يكون عنوان الخادم غير صحيح، أو توجد مشكلة في الشبكة أو إعدادات CORS.";
    }

    showStatus(`فشل الاتصال بالخادم: ${message}`, "error");
  } finally {
    analyzeBtn.disabled = !selectedFile;
  }
});

// عرض نتائج التحليل الحقيقي بعد توصيل الخادم.
function renderResults(data) {
  if (
    !data ||
    typeof data.summary !== "string" ||
    !Array.isArray(data.keyPoints) ||
    typeof data.article !== "string" ||
    !Array.isArray(data.quiz)
  ) {
    showStatus(
      "استجابة التحليل غير مكتملة أو بتنسيق غير صحيح.",
      "error"
    );
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
  $("#results").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
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
    const card = $("#quizForm").querySelector(
      `[data-index="${index}"]`
    );

    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );

    if (!selected) {
      showStatus("جاوب عن كل الأسئلة قبل التصحيح.", "error");
      return;
    }
  }

  questions.forEach((question, index) => {
    const card = $("#quizForm").querySelector(
      `[data-index="${index}"]`
    );

    const selected = card.querySelector(
      `input[name="question-${index}"]:checked`
    );

    const feedback = card.querySelector(".question-feedback");
    const correctIndex = question.answerIndex;
    const selectedIndex = Number(selected.value);
    const labels = card.querySelectorAll(".answer-option");

    labels.forEach((label) => {
      label.classList.remove("correct", "incorrect");
    });

    labels[correctIndex]?.classList.add("correct");

    if (selectedIndex === correctIndex) {
      score++;
    } else {
      labels[selectedIndex]?.classList.add("incorrect");
    }

    feedback.textContent =
      `الإجابة الصحيحة: ${question.options[correctIndex]}` +
      (question.explanation
        ? ` — ${question.explanation}`
        : "");

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
  if (currentResults) {
    renderQuiz(currentResults.quiz);
  }
});

$("#downloadPdf").addEventListener("click", () => {
  window.print();
});

// تستخدمها الواجهة لعرض النتائج بعد اكتمال التحليل.
window.StudyAI = {
  renderResults
};
