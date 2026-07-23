(() => {
  "use strict";

  const TOTAL_QUESTIONS = 5;

  const setupPanel = document.getElementById("setup-panel");
  const interviewPanel = document.getElementById("interview-panel");
  const resultPanel = document.getElementById("result-panel");

  const topicInput = document.getElementById("topic-input");
  const notesInput = document.getElementById("notes-input");
  const startBtn = document.getElementById("start-btn");
  const setupError = document.getElementById("setup-error");

  const interviewTopic = document.getElementById("interview-topic");
  const statusBadge = document.getElementById("status-badge");
  const transcriptEl = document.getElementById("transcript");
  const micBtn = document.getElementById("mic-btn");
  const textForm = document.getElementById("text-form");
  const textInput = document.getElementById("text-input");
  const speechWarning = document.getElementById("speech-warning");

  const scoreNumber = document.getElementById("score-number");
  const reviewPoints = document.getElementById("review-points");
  const restartBtn = document.getElementById("restart-btn");

  /** @type {{role: "system"|"user"|"assistant", content: string}[]} */
  let messages = [];
  let questionCount = 0;
  let finished = false;
  let busy = false;

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supportsRecognition = !!SpeechRecognitionImpl;
  const supportsSynthesis = "speechSynthesis" in window;

  let recognition = null;
  let isListening = false;

  if (supportsRecognition) {
    recognition = new SpeechRecognitionImpl();
    recognition.lang = "it-IT";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      if (transcript) {
        handleStudentAnswer(transcript);
      }
    };

    recognition.onerror = () => {
      setListening(false);
      setStatus("Pronto");
    };

    recognition.onend = () => {
      setListening(false);
    };
  } else {
    micBtn.hidden = true;
    speechWarning.hidden = false;
  }

  function setStatus(text, kind) {
    statusBadge.textContent = text;
    statusBadge.className = "status-badge" + (kind ? " " + kind : "");
  }

  function setListening(active) {
    isListening = active;
    micBtn.classList.toggle("active", active);
    micBtn.querySelector(".mic-label").textContent = active ? "In ascolto..." : "Parla";
  }

  function setBusy(active) {
    busy = active;
    micBtn.disabled = active || finished;
    textInput.disabled = active || finished;
    textForm.querySelector("button").disabled = active || finished;
  }

  function appendMessage(role, text) {
    const div = document.createElement("div");
    div.className = "msg msg-" + role;
    div.textContent = text;
    transcriptEl.appendChild(div);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    return div;
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!supportsSynthesis) {
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "it-IT";
      const voices = window.speechSynthesis.getVoices();
      const itVoice = voices.find((v) => v.lang && v.lang.startsWith("it"));
      if (itVoice) utterance.voice = itVoice;

      utterance.onstart = () => setStatus("Sta parlando...", "speaking");
      utterance.onend = () => {
        setStatus("Pronto");
        resolve();
      };
      utterance.onerror = () => {
        setStatus("Pronto");
        resolve();
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  async function callAI(newMessages) {
    const res = await fetch("/api/deepseek", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: newMessages }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Errore server (${res.status})`);
    }

    const data = await res.json();
    return data.reply;
  }

  const FINAL_MARKER = /VALUTAZIONE FINALE/i;

  function parseFinalEvaluation(text) {
    const votoMatch = text.match(/voto[:\s]*([0-9]{1,2})\s*\/?\s*10/i);
    const voto = votoMatch ? votoMatch[1] : "?";

    const points = [];
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[-•*]\s+/.test(trimmed)) {
        points.push(trimmed.replace(/^[-•*]\s+/, ""));
      }
    }
    return { voto, points };
  }

  function showFinalEvaluation(text) {
    finished = true;
    const { voto, points } = parseFinalEvaluation(text);
    scoreNumber.textContent = voto;
    reviewPoints.innerHTML = "";
    if (points.length === 0) {
      reviewPoints.innerHTML = "<li>Nessun punto specifico indicato.</li>";
    } else {
      for (const p of points) {
        const li = document.createElement("li");
        li.textContent = p;
        reviewPoints.appendChild(li);
      }
    }
    interviewPanel.hidden = true;
    resultPanel.hidden = false;
    if (supportsSynthesis) window.speechSynthesis.cancel();
  }

  async function requestNextStep(userReplyText) {
    if (userReplyText !== null) {
      messages.push({ role: "user", content: userReplyText });
    }

    setBusy(true);
    setStatus("Sta elaborando...", "thinking");

    try {
      const reply = await callAI(messages);
      messages.push({ role: "assistant", content: reply });

      if (FINAL_MARKER.test(reply)) {
        appendMessage("system", "Valutazione finale ricevuta.");
        showFinalEvaluation(reply);
        return;
      }

      questionCount += 1;
      appendMessage("ai", reply);
      setBusy(false);
      await speak(reply);
    } catch (err) {
      appendMessage("error", "Errore: " + err.message + ". Riprova.");
      setStatus("Pronto");
      setBusy(false);
    }
  }

  function handleStudentAnswer(text) {
    if (busy || finished) return;
    appendMessage("user", text);
    requestNextStep(text);
  }

  micBtn.addEventListener("click", () => {
    if (!supportsRecognition || busy || finished) return;
    if (isListening) {
      recognition.stop();
      return;
    }
    try {
      setStatus("In ascolto...", "listening");
      setListening(true);
      recognition.start();
    } catch (e) {
      setListening(false);
      setStatus("Pronto");
    }
  });

  textForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text || busy || finished) return;
    textInput.value = "";
    handleStudentAnswer(text);
  });

  startBtn.addEventListener("click", async () => {
    const topic = topicInput.value.trim();
    const notes = notesInput.value.trim();

    if (!topic) {
      setupError.textContent = "Inserisci un argomento per iniziare.";
      setupError.hidden = false;
      return;
    }
    setupError.hidden = true;

    const systemPrompt = buildSystemPrompt(topic, notes);
    messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Inizia l'interrogazione con la prima domanda." },
    ];
    questionCount = 0;
    finished = false;

    interviewTopic.textContent = topic;
    transcriptEl.innerHTML = "";
    setupPanel.hidden = true;
    resultPanel.hidden = true;
    interviewPanel.hidden = false;
    setStatus("Sta elaborando...", "thinking");
    setBusy(true);

    try {
      const reply = await callAI(messages);
      messages.push({ role: "assistant", content: reply });
      questionCount += 1;
      appendMessage("ai", reply);
      setBusy(false);
      await speak(reply);
    } catch (err) {
      appendMessage("error", "Errore: " + err.message + ". Riprova.");
      setStatus("Pronto");
      setBusy(false);
    }
  });

  restartBtn.addEventListener("click", () => {
    topicInput.value = "";
    notesInput.value = "";
    messages = [];
    questionCount = 0;
    finished = false;
    transcriptEl.innerHTML = "";
    resultPanel.hidden = true;
    interviewPanel.hidden = true;
    setupPanel.hidden = false;
    setStatus("Pronto");
  });

  function buildSystemPrompt(topic, notes) {
    const notesBlock = notes
      ? `Appunti/testo di riferimento forniti dallo studente:\n"""\n${notes}\n"""\n`
      : "";

    return [
      `Sei un tutor AI che interroga oralmente uno studente italiano sull'argomento: "${topic}".`,
      notesBlock,
      "Regole obbligatorie:",
      `- Fai UNA domanda alla volta, chiara, adatta a un'interrogazione orale (non troppo lunga).`,
      "- Dopo ogni risposta dello studente, dai un feedback breve (massimo 2-3 frasi): correggi eventuali errori o imprecisioni, poi fai la domanda successiva.",
      `- In totale devi fare ${TOTAL_QUESTIONS} domande sull'argomento, di difficoltà e argomenti via via diversi (non ripetere le stesse domande).`,
      `- Dopo il feedback alla risposta della ${TOTAL_QUESTIONS}ª domanda, NON fare un'altra domanda: fornisci invece la valutazione finale, e SOLO quella, con questo formato esatto:`,
      "VALUTAZIONE FINALE",
      "Voto: X/10",
      "Punti da ripassare:",
      "- punto 1",
      "- punto 2",
      "- punto 3 (facoltativo)",
      "- Non aggiungere altro testo dopo la valutazione finale.",
      "- Rispondi sempre in italiano, con tono incoraggiante ma onesto.",
    ].join("\n");
  }

  if (supportsSynthesis) {
    // Alcuni browser popolano le voci in modo asincrono.
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
})();
