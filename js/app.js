(() => {
  "use strict";

  const TOTAL_QUESTIONS = 5;
  const SILENCE_TIMEOUT_MS = 1400; // pausa tollerata prima di considerare finita la risposta
  const MAX_RECORDING_MS = 60000; // salvagente: interrompe l'ascolto se resta aperto troppo a lungo

  const setupPanel = document.getElementById("setup-panel");
  const interviewPanel = document.getElementById("interview-panel");
  const resultPanel = document.getElementById("result-panel");

  const topicInput = document.getElementById("topic-input");
  const notesInput = document.getElementById("notes-input");
  const startBtn = document.getElementById("start-btn");
  const setupError = document.getElementById("setup-error");

  const interviewTopic = document.getElementById("interview-topic");
  const orbWrap = document.getElementById("orb-wrap");
  const orbAura = document.getElementById("orb-aura");
  const statusLine = document.getElementById("status-line");
  const inlineAlert = document.getElementById("inline-alert");
  const transcriptEl = document.getElementById("transcript");
  const transcriptToggleBtn = document.getElementById("transcript-toggle-btn");
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
  let silenceTimer = null;
  let maxDurationTimer = null;
  let accumulatedFinal = "";

  // ---------- Orb / aura ----------

  function setOrbState(state) {
    orbWrap.classList.remove("idle", "state-listening", "state-ai-speaking");
    if (state === "listening") orbWrap.classList.add("state-listening");
    else if (state === "ai-speaking") orbWrap.classList.add("state-ai-speaking");
    else orbWrap.classList.add("idle");
  }

  function setAuraScale(scale) {
    orbAura.style.setProperty("--aura-scale", scale.toFixed(3));
  }

  function setStatus(text, kind) {
    statusLine.textContent = text;
    if (kind === "listening") setOrbState("listening");
    else if (kind === "speaking") setOrbState("ai-speaking");
    else setOrbState("idle");
  }

  function showAlert(text) {
    inlineAlert.textContent = text;
    inlineAlert.hidden = false;
  }

  function clearAlert() {
    inlineAlert.hidden = true;
  }

  function reportError(text) {
    showAlert(text);
    appendMessage("error", text);
  }

  // ---------- Visualizzatore audio microfono (aura reattiva mentre parla lo studente) ----------

  let micStream = null;
  let audioCtx = null;
  let analyser = null;
  let userAnimHandle = null;

  async function startAudioVisualizer() {
    if (audioCtx) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setAuraScale(1 + Math.min(rms * 5, 0.9));
        userAnimHandle = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      // Permesso negato o dispositivo non disponibile: l'aura resta statica,
      // ma il riconoscimento vocale (permesso separato) puo' comunque funzionare.
    }
  }

  function stopAudioVisualizer() {
    if (userAnimHandle) cancelAnimationFrame(userAnimHandle);
    userAnimHandle = null;
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    analyser = null;
    setAuraScale(1);
  }

  // ---------- Animazione aura mentre parla l'AI (basata sui confini di parola) ----------

  let aiAnimHandle = null;
  let aiPulseBoost = 0;

  function startAiSpeakingAnimation() {
    let t = 0;
    const tick = () => {
      t += 0.12;
      aiPulseBoost *= 0.85;
      const base = 1.15 + Math.sin(t) * 0.1 + aiPulseBoost;
      setAuraScale(base);
      aiAnimHandle = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopAiSpeakingAnimation() {
    if (aiAnimHandle) cancelAnimationFrame(aiAnimHandle);
    aiAnimHandle = null;
    aiPulseBoost = 0;
    setAuraScale(1);
  }

  function bumpAuraPulse() {
    aiPulseBoost = 0.25;
  }

  // ---------- Riconoscimento vocale ----------

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (isListening) recognition.stop();
    }, SILENCE_TIMEOUT_MS);
  }

  function describeRecognitionError(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "Microfono bloccato: controlla il permesso microfono per questo sito nelle impostazioni del browser (icona lucchetto nella barra indirizzi) e ricarica la pagina.";
      case "no-speech":
        return "Non ho sentito nulla. Riprova a parlare premendo di nuovo il pulsante.";
      case "audio-capture":
        return "Nessun microfono trovato o utilizzabile dal browser.";
      case "network":
        return "Errore di rete durante il riconoscimento vocale. Riprova.";
      case "aborted":
        return null;
      default:
        return "Errore riconoscimento vocale (" + code + "). Riprova o usa la tastiera.";
    }
  }

  if (supportsRecognition) {
    recognition = new SpeechRecognitionImpl();
    recognition.lang = "it-IT";
    // continuous=true: il riconoscimento non si interrompe da solo alla prima
    // pausa. Decidiamo noi quando lo studente ha finito, con un timer di
    // silenzio (SILENCE_TIMEOUT_MS) che tollera piccole pause o "ehm".
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          accumulatedFinal += result[0].transcript;
        }
      }
      resetSilenceTimer();
    };

    recognition.onaudiostart = () => {
      setStatus("In ascolto...", "listening");
      startAudioVisualizer();
    };

    recognition.onspeechstart = () => {
      setStatus("Ti sento, continua...", "listening");
    };

    recognition.onspeechend = () => {
      setStatus("Sto elaborando...", "thinking");
    };

    recognition.onerror = (event) => {
      stopAudioVisualizer();
      clearTimeout(silenceTimer);
      clearTimeout(maxDurationTimer);
      setListening(false);
      setStatus("Pronto");
      accumulatedFinal = "";
      const message = describeRecognitionError(event.error);
      if (message) reportError(message);
    };

    recognition.onend = () => {
      stopAudioVisualizer();
      clearTimeout(silenceTimer);
      clearTimeout(maxDurationTimer);
      setListening(false);
      const answer = accumulatedFinal.trim();
      accumulatedFinal = "";
      if (answer) {
        handleStudentAnswer(answer);
      } else {
        setStatus("Pronto");
      }
    };
  } else {
    micBtn.hidden = true;
    speechWarning.hidden = false;
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

  // ---------- Sintesi vocale ----------

  function speak(text) {
    return new Promise((resolve) => {
      if (!supportsSynthesis) {
        resolve();
        return;
      }
      const synth = window.speechSynthesis;
      const spoken = sanitizeForSpeech(text);

      const doSpeak = () => {
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.lang = "it-IT";
        const voices = synth.getVoices();
        const itVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("it"));
        if (itVoice) utterance.voice = itVoice;

        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          stopAiSpeakingAnimation();
          setStatus("Pronto");
          resolve();
        };

        utterance.onstart = () => {
          setStatus("Sta parlando...", "speaking");
          startAiSpeakingAnimation();
        };
        utterance.onboundary = () => bumpAuraPulse();
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);

        // Alcune versioni di Chrome non emettono mai onend/onerror in certi
        // casi (bug noto): sblocchiamo comunque l'interfaccia dopo un timeout
        // di sicurezza proporzionale alla lunghezza del testo.
        setTimeout(finish, Math.max(4000, spoken.length * 90));
      };

      // Chiamare speak() subito dopo cancel() puo' non produrre audio su
      // Chrome (bug noto): se la sintesi e' occupata, annulliamo e aspettiamo
      // un istante prima di far partire la nuova frase.
      if (synth.speaking || synth.pending) {
        synth.cancel();
        setTimeout(doSpeak, 60);
      } else {
        doSpeak();
      }
    });
  }

  function unlockSpeechSynthesis() {
    if (!supportsSynthesis) return;
    // Su alcuni browser (Safari/iOS in particolare) speechSynthesis.speak()
    // funziona in modo affidabile solo se la prima chiamata avviene in modo
    // sincrono dentro un gesto utente (click). Questa frase quasi silenziosa
    // "sblocca" il motore per le chiamate asincrone successive.
    const unlock = new SpeechSynthesisUtterance(" ");
    unlock.volume = 0;
    window.speechSynthesis.speak(unlock);
  }

  // Converte notazione LaTeX/markdown residua in italiano leggibile ad alta
  // voce (rete di sicurezza: il system prompt chiede gia' a DeepSeek di non
  // usarla, ma i modelli non sono affidabili al 100%).
  function sanitizeForSpeech(text) {
    let t = text;

    t = t.replace(/\\\[|\\\]|\\\(|\\\)/g, "");
    t = t.replace(/\$\$?/g, "");

    t = t.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 fratto $2");
    t = t.replace(/\\sqrt\{([^{}]*)\}/g, "radice quadrata di $1");

    t = t.replace(/\^\{?2\}?/g, " al quadrato");
    t = t.replace(/\^\{?3\}?/g, " al cubo");
    t = t.replace(/\^\{?([^\s{}]+)\}?/g, " alla $1");
    t = t.replace(/_\{?([^\s{}]+)\}?/g, " con indice $1");

    const replacements = [
      [/\\times/g, " per "],
      [/\\cdot/g, " per "],
      [/\\div/g, " diviso "],
      [/\\pm/g, " piu' o meno "],
      [/\\leq/g, " minore o uguale a "],
      [/\\geq/g, " maggiore o uguale a "],
      [/\\neq/g, " diverso da "],
      [/\\approx/g, " circa uguale a "],
      [/\\rightarrow/g, " tende a "],
      [/\\to/g, " tende a "],
      [/\\infty/g, " infinito "],
      [/\\pi/g, " pi greco "],
      [/\\alpha/g, " alfa "],
      [/\\beta/g, " beta "],
      [/\\gamma/g, " gamma "],
      [/\\delta/g, " delta "],
      [/\\theta/g, " theta "],
      [/\\sum/g, " sommatoria "],
      [/\\int/g, " integrale "],
    ];
    for (const [pattern, replacement] of replacements) {
      t = t.replace(pattern, replacement);
    }

    t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
    t = t.replace(/\*([^*]+)\*/g, "$1");
    t = t.replace(/`([^`]+)`/g, "$1");

    t = t.replace(/[{}]/g, "");
    t = t.replace(/\\/g, "");
    t = t.replace(/(\d)\/(\d)/g, "$1 su $2");

    t = t.replace(/\s{2,}/g, " ").trim();

    return t;
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
      reportError("Errore: " + err.message + ". Riprova.");
      setStatus("Pronto");
      setBusy(false);
    }
  }

  function handleStudentAnswer(text) {
    if (busy || finished) return;
    clearAlert();
    appendMessage("user", text);
    requestNextStep(text);
  }

  micBtn.addEventListener("click", () => {
    if (!supportsRecognition || busy || finished) return;
    if (isListening) {
      recognition.stop();
      return;
    }
    clearAlert();
    accumulatedFinal = "";
    try {
      setListening(true);
      setStatus("In ascolto...", "listening");
      recognition.start();
      maxDurationTimer = setTimeout(() => {
        if (isListening) recognition.stop();
      }, MAX_RECORDING_MS);
    } catch (e) {
      // Se il riconoscimento risultava gia' avviato (stato incoerente in
      // alcuni browser), lo fermiamo e riproviamo una volta.
      try {
        recognition.abort();
        recognition.start();
      } catch (e2) {
        setListening(false);
        setStatus("Pronto");
        reportError("Impossibile avviare il microfono. Ricarica la pagina e riprova.");
      }
    }
  });

  transcriptToggleBtn.addEventListener("click", () => {
    transcriptEl.hidden = !transcriptEl.hidden;
    transcriptToggleBtn.textContent = transcriptEl.hidden ? "Trascrivi" : "Nascondi trascrizione";
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
    unlockSpeechSynthesis();

    const systemPrompt = buildSystemPrompt(topic, notes);
    messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Inizia l'interrogazione con la prima domanda." },
    ];
    questionCount = 0;
    finished = false;

    interviewTopic.textContent = topic;
    transcriptEl.innerHTML = "";
    transcriptEl.hidden = true;
    transcriptToggleBtn.textContent = "Trascrivi";
    clearAlert();
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
      reportError("Errore: " + err.message + ". Riprova.");
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
    clearAlert();
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
      "- Le tue risposte verranno lette ad alta voce da un sintetizzatore vocale: non usare MAI notazione LaTeX, markdown, backslash o simboli come ^, _, \\frac, \\sqrt, asterischi per il grassetto. Scrivi ogni formula o simbolo matematico per esteso, in italiano colloquiale (es. 'x al quadrato' invece di x^2, 'la radice quadrata di 16' invece di \\sqrt{16}, 'due terzi' invece di 2/3, 'a fratto b' invece di \\frac{a}{b}).",
    ].join("\n");
  }

  if (supportsSynthesis) {
    // Alcuni browser popolano le voci in modo asincrono.
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
})();
