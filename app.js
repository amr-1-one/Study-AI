
const $ = id => document.getElementById(id);

const canvas = $("canvas");
const ctx = canvas.getContext("2d");

const state = {
  scenes: [],
  images: [],
  current: 0,
  audio: null,
  audioUrl: null,
  exporting: false
};

function setStatus(message) {
  $("status").textContent = message;
}

function splitScenes(text, count) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  let parts = clean.split(/(?<=[.!?؟。])\s+/).filter(Boolean);

  if (parts.length < 2) {
    const words = clean.split(" ");
    const groups = Math.min(count, Math.max(1, Math.ceil(words.length / 8)));
    const size = Math.ceil(words.length / groups);

    parts = [];
    for (let i = 0; i < words.length; i += size) {
      parts.push(words.slice(i, i + size).join(" "));
    }
  } else if (parts.length > count) {
    const size = Math.ceil(parts.length / count);
    const merged = [];

    for (let i = 0; i < parts.length; i += size) {
      merged.push(parts.slice(i, i + size).join(" "));
    }

    parts = merged;
  }

  return parts.map((text, i) => ({
    title: `المشهد ${i + 1}`,
    text
  }));
}

function buildScenes() {
  const idea = $("idea").value.trim();

  if (!idea) {
    setStatus("اكتب فكرتك أولًا.");
    $("idea").focus();
    return;
  }

  const count = Math.max(
    2,
    Math.min(6, Math.round(Number($("duration").value) / 8))
  );

  state.scenes = splitScenes(idea, count);
  state.images = state.scenes.map((_, i) => state.images[i] || null);
  state.current = 0;

  $("voiceText").value = state.scenes.map(s => s.text).join(" ");

  const select = $("sceneSelect");
  select.innerHTML = "";

  state.scenes.forEach((scene, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `${i + 1}. ${scene.title}`;
    select.appendChild(option);
  });

  $("export").disabled = false;
  showScene();

  setStatus(
    `تم تجهيز ${state.scenes.length} مشاهد. أضف الصور والصوت ثم صدّر الفيديو.`
  );
}

function wrapText(text, maxWidth, font) {
  ctx.font = font;

  const words = text.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;

    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function drawPreview() {
  const width = canvas.width;
  const height = canvas.height;
  const image = state.images[state.current];

  ctx.clearRect(0, 0, width, height);

  if (image && image.complete && image.naturalWidth > 0) {
    const scale = Math.max(
      width / image.naturalWidth,
      height / image.naturalHeight
    );

    const sourceWidth = width / scale;
    const sourceHeight = height / scale;

    ctx.drawImage(
      image,
      (image.naturalWidth - sourceWidth) / 2,
      (image.naturalHeight - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height
    );

    ctx.fillStyle = "rgba(8, 6, 20, 0.5)";
    ctx.fillRect(0, 0, width, height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);

    gradient.addColorStop(0, "#39265b");
    gradient.addColorStop(0.55, "#19132d");
    gradient.addColorStop(1, "#080811");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(174, 140, 255, 0.14)";
    ctx.beginPath();
    ctx.arc(width * 0.7, height * 0.25, width * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";

  ctx.fillStyle = "#d6c8ff";
  ctx.font = "700 14px Cairo, Arial, sans-serif";
  ctx.fillText("فكرة لفيديو", width / 2, 58);

  ctx.beginPath();

  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(20, height * 0.55, width - 40, height * 0.32, 18);
  } else {
    ctx.rect(20, height * 0.55, width - 40, height * 0.32);
  }

  ctx.fillStyle = "rgba(7, 6, 16, 0.72)";
  ctx.fill();

  const text = state.scenes[state.current]?.text ||
    "اكتب فكرتك وابدأ تجهيز المشاهد";

  const lines = wrapText(
    text,
    width - 62,
    "700 23px Cairo, Arial, sans-serif"
  ).slice(0, 5);

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 23px Cairo, Arial, sans-serif";

  const startY = height * 0.69 - ((lines.length - 1) * 35) / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, startY + i * 35);
  });

  ctx.fillStyle = "#d6ccf7";
  ctx.font = "12px Cairo, Arial, sans-serif";

  const counter = state.scenes.length
    ? `${state.current + 1} / ${state.scenes.length}`
    : "معاينة 9:16";

  ctx.fillText(counter, width / 2, height - 27);
}

function showScene() {
  if (!state.scenes.length) {
    $("sceneText").value = "";
    drawPreview();
    return;
  }

  state.current = Math.max(
    0,
    Math.min(state.current, state.scenes.length - 1)
  );

  $("sceneSelect").value = String(state.current);
  $("sceneText").value = state.scenes[state.current].text;

  drawPreview();
}

function addSceneImage(file) {
  if (!file || !file.type.startsWith("image/")) return;

  if (!state.scenes.length) {
    setStatus("جهّز المشاهد أولًا قبل إضافة الصور.");
    return;
  }

  const url = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    const previous = state.images[state.current];

    if (previous?.src?.startsWith("blob:")) {
      URL.revokeObjectURL(previous.src);
    }

    state.images[state.current] = image;
    drawPreview();

    setStatus(`تمت إضافة صورة للمشهد ${state.current + 1}.`);
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus("تعذر فتح الصورة. جرّب صورة أخرى.");
  };

  image.src = url;
}

function previewVoice() {
  const text = $("voiceText").value.trim();

  if (!text) {
    setStatus("اكتب نص التعليق الصوتي أولًا.");
    return;
  }

  if (!("speechSynthesis" in window)) {
    setStatus("المتصفح لا يدعم الصوت التجريبي.");
    return;
  }

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = $("voiceLang").value;
  utterance.rate = 0.95;

  utterance.onstart = () => {
    setStatus("يعمل الصوت التجريبي. لن يُدمج تلقائيًا في الفيديو.");
  };

  utterance.onend = () => {
    setStatus("انتهت معاينة الصوت.");
  };

  utterance.onerror = () => {
    setStatus("تعذر تشغيل الصوت على هذا الجهاز.");
  };

  speechSynthesis.speak(utterance);
}

function loadAudio(file) {
  if (!file || !file.type.startsWith("audio/")) {
    setStatus("اختار ملفًا صوتيًا صالحًا.");
    return;
  }

  if (state.audioUrl) {
    URL.revokeObjectURL(state.audioUrl);
  }

  if (state.audio) {
    state.audio.pause();
    state.audio.removeAttribute("src");
    state.audio.load();
  }

  state.audioUrl = URL.createObjectURL(file);
  state.audio = new Audio(state.audioUrl);
  state.audio.preload = "auto";

  state.audio.addEventListener("error", () => {
    setStatus("تعذر قراءة الملف الصوتي. جرّب ملف MP3 أو WAV.");
  }, { once: true });

  state.audio.load();
  setStatus("تم اختيار ملف الصوت.");
}

async function exportVideo() {
  if (state.exporting || !state.scenes.length) return;

  if (!canvas.captureStream || !window.MediaRecorder) {
    setStatus("التصدير غير مدعوم. جرّب Chrome أو Edge على الكمبيوتر.");
    return;
  }

  state.exporting = true;
  $("export").disabled = true;

  const originalScene = state.current;

  let stream;
  let recorder;
  let audioContext;
  let audioSource;
  let audioDestination;
  let animationId;
  let drawing = false;

  const chunks = [];

  try {
    const duration = Math.max(
      5,
      Math.min(180, Number($("duration").value) || 30)
    );

    const secondsPerScene = duration / state.scenes.length;

    state.current = 0;
    showScene();

    await new Promise(resolve => requestAnimationFrame(resolve));

    stream = canvas.captureStream(30);

    if (state.audio) {
      audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();

      await audioContext.resume();

      audioSource = audioContext.createMediaElementSource(state.audio);
      audioDestination = audioContext.createMediaStreamDestination();

      audioSource.connect(audioDestination);
      audioSource.connect(audioContext.destination);

      audioDestination.stream.getAudioTracks().forEach(track => {
        stream.addTrack(track);
      });
    }

    let mimeType = "";

    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) {
      mimeType = "video/webm;codecs=vp8,opus";
    } else if (MediaRecorder.isTypeSupported("video/webm")) {
      mimeType = "video/webm";
    }

    recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => {
        reject(new Error("حدث خطأ أثناء تسجيل الفيديو."));
      };
    });

    drawing = true;

    function keepDrawing() {
      if (!drawing) return;
      drawPreview();
      animationId = requestAnimationFrame(keepDrawing);
    }

    keepDrawing();
    recorder.start(1000);

    if (state.audio) {
      state.audio.pause();
      state.audio.currentTime = 0;

      try {
        await state.audio.play();
      } catch (error) {
        setStatus("تعذر تشغيل الصوت. تحقق من الملف المرفوع.");
      }
    }

    for (let i = 0; i < state.scenes.length; i++) {
      state.current = i;
      showScene();

      setStatus(`جارٍ تسجيل المشهد ${i + 1} من ${state.scenes.length}...`);

      const start = performance.now();

      while (performance.now() - start < secondsPerScene * 1000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    drawing = false;
    cancelAnimationFrame(animationId);

    drawPreview();
    await new Promise(resolve => setTimeout(resolve, 300));

    if (recorder.state !== "inactive") {
      recorder.stop();
    }

    await finished;

    if (state.audio) state.audio.pause();

    const blob = new Blob(chunks, {
      type: recorder.mimeType || "video/webm"
    });

    if (!blob.size) {
      throw new Error("ملف الفيديو الناتج فارغ.");
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "idea-to-shorts.webm";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60000);

    setStatus(
      `تم تصدير الفيديو بنجاح. الحجم: ${(blob.size / 1024 / 1024).toFixed(2)} ميجابايت.`
    );

  } catch (error) {
    console.error("Video export error:", error);
    setStatus("فشل التصدير: " + (error.message || "خطأ غير معروف."));

  } finally {
    drawing = false;

    if (animationId) {
      cancelAnimationFrame(animationId);
    }

    if (state.audio) state.audio.pause();

    if (audioSource) {
      try {
        audioSource.disconnect();
      } catch {}
    }

    if (audioContext) {
      try {
        await audioContext.close();
      } catch {}
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    state.current = originalScene;
    showScene();

    state.exporting = false;
    $("export").disabled = !state.scenes.length;
  }
}

// ربط الأزرار
$("build").addEventListener("click", buildScenes);

$("sceneSelect").addEventListener("change", () => {
  state.current = Number($("sceneSelect").value);
  showScene();
});

$("sceneText").addEventListener("input", () => {
  if (state.scenes[state.current]) {
    state.scenes[state.current].text = $("sceneText").value;
    drawPreview();
  }
});

$("imageFile").addEventListener("change", event => {
  addSceneImage(event.target.files[0]);
});

$("audioFile").addEventListener("change", event => {
  loadAudio(event.target.files[0]);
});

$("speak").addEventListener("click", previewVoice);

$("stopSpeak").addEventListener("click", () => {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  setStatus("تم إيقاف الصوت.");
});

$("prev").addEventListener("click", () => {
  state.current = Math.max(0, state.current - 1);
  showScene();
});

$("next").addEventListener("click", () => {
  state.current = Math.min(
    state.scenes.length - 1,
    state.current + 1
  );
  showScene();
});

$("export").addEventListener("click", exportVideo);

drawPreview();
