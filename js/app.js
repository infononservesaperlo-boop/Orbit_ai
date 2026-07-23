(() => {
  "use strict";

  const SILENCE_TIMEOUT_MS = 5000; // pausa tollerata prima di considerare finita la risposta
  const MAX_RECORDING_MS = 600000; // salvagente: interrompe l'ascolto se resta aperto troppo a lungo (10 minuti)

  const setupPanel = document.getElementById("setup-panel");
  const interviewPanel = document.getElementById("interview-panel");
  const resultPanel = document.getElementById("result-panel");

  const subjectInput = document.getElementById("subject-input");
  const schoolInput = document.getElementById("school-input");
  const yearInput = document.getElementById("year-input");
  const topicInput = document.getElementById("topic-input");
  const notesInput = document.getElementById("notes-input");
  const startBtn = document.getElementById("start-btn");
  const setupError = document.getElementById("setup-error");

  // ---------- Controlli segmentati (difficolta', personalita', n. domande) ----------

  let selectedDifficulty = "medio";
  let selectedPersonality = "neutro";
  let selectedNumQuestions = "1";

  const segmentedThumbUpdaters = [];

  function initSegmentedControl(groupId, thumbId, onChange) {
    const group = document.getElementById(groupId);
    const thumb = document.getElementById(thumbId);

    function update() {
      const active = group.querySelector(".segment.active");
      if (!active) return;
      thumb.style.width = active.offsetWidth + "px";
      thumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
    }

    group.querySelectorAll(".segment").forEach((btn) => {
      btn.addEventListener("click", () => {
        group.querySelectorAll(".segment").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        onChange(btn.dataset.value);
        update();
      });
    });

    segmentedThumbUpdaters.push(update);
  }

  initSegmentedControl("difficulty-group", "difficulty-thumb", (v) => {
    selectedDifficulty = v;
  });
  initSegmentedControl("personality-group", "personality-thumb", (v) => {
    selectedPersonality = v;
  });
  initSegmentedControl("questions-group", "questions-thumb", (v) => {
    selectedNumQuestions = v;
  });

  function updateAllSegmentedThumbs() {
    segmentedThumbUpdaters.forEach((fn) => fn());
  }

  window.addEventListener("resize", updateAllSegmentedThumbs);
  window.addEventListener("load", updateAllSegmentedThumbs);
  requestAnimationFrame(updateAllSegmentedThumbs);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateAllSegmentedThumbs);
  }

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
  const scoreRingFill = document.getElementById("score-ring-fill");
  const reviewPoints = document.getElementById("review-points");
  const restartBtn = document.getElementById("restart-btn");

  const SCORE_RING_CIRCUMFERENCE = 2 * Math.PI * 60;
  scoreRingFill.style.strokeDasharray = String(SCORE_RING_CIRCUMFERENCE);
  scoreRingFill.style.strokeDashoffset = String(SCORE_RING_CIRCUMFERENCE);

  function revealPanel(el) {
    el.hidden = false;
    el.classList.remove("panel-anim");
    void el.offsetWidth; // forza il reflow per far ripartire l'animazione ogni volta
    el.classList.add("panel-anim");
  }

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
  //
  // Voce principale: Azure Speech (voce neurale, molto piu' naturale),
  // tramite /api/tts. Se non disponibile (chiave non configurata, quota
  // esaurita, errore di rete) si torna automaticamente alla sintesi vocale
  // nativa del browser, cosi' l'app funziona comunque.

  let ttsAudioEl = null;
  let ttsAudioCtx = null;
  let ttsAnalyser = null;
  let cloudTtsAvailable = true;

  // Un WAV silenzioso di pochi campioni, usato solo per "sbloccare" la
  // riproduzione audio programmatica su Safari/iOS (che richiede che il primo
  // play() su un elemento/contesto avvenga in modo sincrono dentro un gesto
  // utente, come il click su "Inizia interrogazione").
  const SILENT_WAV_DATA_URI =
    "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA";

  function ensureTtsAudioEl() {
    if (!ttsAudioEl) {
      ttsAudioEl = new Audio();
    }
    return ttsAudioEl;
  }

  function visualizeAnalyser(analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    let handle;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      setAuraScale(1 + Math.min(rms * 5, 0.9));
      handle = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(handle);
  }

  function unlockTtsPlayback() {
    const el = ensureTtsAudioEl();
    try {
      if (!ttsAudioCtx) {
        ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const sourceNode = ttsAudioCtx.createMediaElementSource(el);
        ttsAnalyser = ttsAudioCtx.createAnalyser();
        ttsAnalyser.fftSize = 512;
        sourceNode.connect(ttsAnalyser);
        ttsAnalyser.connect(ttsAudioCtx.destination);
      }
      ttsAudioCtx.resume();
    } catch (e) {
      // Se il grafo Web Audio non si crea, l'audio suonera' comunque tramite
      // l'elemento <audio> diretto: solo l'aura reattiva non funzionera' (si
      // torna all'animazione a impulsi di riserva in startAiSpeakingAnimation).
    }
    el.muted = true;
    el.src = SILENT_WAV_DATA_URI;
    el.play()
      .catch(() => {})
      .finally(() => {
        el.muted = false;
      });
  }

  async function fetchTtsAudio(text) {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Errore TTS (${res.status})`);
    }
    const data = await res.json();
    return data.audioContent;
  }

  function playTtsAudio(base64Mp3) {
    return new Promise((resolve, reject) => {
      const el = ensureTtsAudioEl();
      el.src = "data:audio/mp3;base64," + base64Mp3;

      let stopVisualizer = null;

      el.onplay = () => {
        setStatus("Sta parlando...", "speaking");
        if (ttsAnalyser) {
          if (ttsAudioCtx.state === "suspended") ttsAudioCtx.resume();
          stopVisualizer = visualizeAnalyser(ttsAnalyser);
        } else {
          startAiSpeakingAnimation();
        }
      };

      const finish = () => {
        if (stopVisualizer) stopVisualizer();
        else stopAiSpeakingAnimation();
        setStatus("Pronto");
        resolve();
      };

      el.onended = finish;
      el.onerror = () => reject(new Error("Riproduzione audio TTS fallita"));

      el.play().catch(reject);
    });
  }

  async function speak(text) {
    const spoken = sanitizeForSpeech(text);
    if (!spoken) return;

    if (cloudTtsAvailable) {
      try {
        const audioBase64 = await fetchTtsAudio(spoken);
        await playTtsAudio(audioBase64);
        return;
      } catch (err) {
        // La voce cloud non e' disponibile (chiave assente, quota esaurita,
        // rete assente): niente panico, si prosegue con la voce del browser
        // per il resto della sessione.
        cloudTtsAvailable = false;
      }
    }
    await speakWithBrowserSynthesis(spoken);
  }

  function speakWithBrowserSynthesis(spoken) {
    return new Promise((resolve) => {
      if (!supportsSynthesis) {
        resolve();
        return;
      }
      const synth = window.speechSynthesis;

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
    // "sblocca" il motore per le chiamate asincrone successive (usata come
    // riserva se la voce cloud non e' disponibile).
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
    revealPanel(resultPanel);
    stopAllSpeech();

    const votoNum = parseFloat(voto);
    scoreRingFill.style.strokeDashoffset = String(SCORE_RING_CIRCUMFERENCE);
    if (!Number.isNaN(votoNum)) {
      const clamped = Math.max(0, Math.min(10, votoNum));
      const offset = SCORE_RING_CIRCUMFERENCE * (1 - clamped / 10);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scoreRingFill.style.strokeDashoffset = String(offset);
        });
      });
    }
  }

  function stopAllSpeech() {
    if (ttsAudioEl) ttsAudioEl.pause();
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
    const subject = subjectInput.value;
    const school = schoolInput.value;
    const year = yearInput.value;

    if (!topic) {
      setupError.textContent = "Inserisci un argomento per iniziare.";
      setupError.hidden = false;
      return;
    }
    setupError.hidden = true;
    unlockTtsPlayback();
    unlockSpeechSynthesis();

    const systemPrompt = buildSystemPrompt({
      topic,
      notes,
      subject,
      school,
      year,
      difficulty: selectedDifficulty,
      personality: selectedPersonality,
      numQuestions: selectedNumQuestions,
    });
    messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Inizia l'interrogazione con la prima domanda." },
    ];
    questionCount = 0;
    finished = false;

    interviewTopic.textContent = subject ? `${subject} · ${topic}` : topic;
    transcriptEl.innerHTML = "";
    transcriptEl.hidden = true;
    transcriptToggleBtn.textContent = "Trascrivi";
    clearAlert();
    setupPanel.hidden = true;
    resultPanel.hidden = true;
    revealPanel(interviewPanel);
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
    stopAllSpeech();
    topicInput.value = "";
    notesInput.value = "";
    messages = [];
    questionCount = 0;
    finished = false;
    transcriptEl.innerHTML = "";
    clearAlert();
    resultPanel.hidden = true;
    interviewPanel.hidden = true;
    revealPanel(setupPanel);
    setStatus("Pronto");
  });

  const DIFFICULTY_LABELS = {
    basso: "Basso: domande semplici e dirette sui concetti fondamentali, linguaggio chiaro; nei feedback spiega con calma eventuali errori senza appesantire.",
    medio: "Medio: livello standard per uno studente che ha studiato con regolarita'; domande di comprensione e applicazione dei concetti, non solo mnemoniche.",
    alto: "Alto: domande approfondite che richiedono ragionamento, collegamenti tra concetti diversi, precisione nei dettagli ed esempi articolati; sii piu' esigente nella valutazione.",
  };

  const PERSONALITY_LABELS = {
    serio: "Sei un professore molto serio e rigoroso: tono formale, esigente, poco incline a battute o convenevoli; pretendi precisione nelle risposte. Resta comunque sempre rispettoso e mai umiliante.",
    neutro: "Mantieni un tono professionale, cordiale e diretto: né troppo severo né troppo scherzoso, il classico tutor equilibrato.",
    scherzoso: "Sei gentile, incoraggiante e con un tocco di leggerezza e simpatia (qualche battuta leggera se ci sta bene), ma senza perdere di vista la serietà della verifica: resta comunque un'interrogazione vera.",
  };

  function buildSystemPrompt({ topic, notes, subject, school, year, difficulty, personality, numQuestions }) {
    const notesBlock = notes
      ? `Appunti/testo di riferimento forniti dallo studente:\n"""\n${notes}\n"""\n`
      : "";
    const difficultyText = DIFFICULTY_LABELS[difficulty] || DIFFICULTY_LABELS.medio;
    const personalityText = PERSONALITY_LABELS[personality] || PERSONALITY_LABELS.neutro;
    const subjectText = subject || "non specificata: deducila dall'argomento se puoi, altrimenti resta generico";
    const schoolText = school || "non specificato: procedi in modalita' standard, senza calibrare su un indirizzo scolastico particolare";
    const totalQuestions = Number(numQuestions) > 0 ? Math.min(5, Math.round(Number(numQuestions))) : 1;
    const questionsPhrase = totalQuestions === 1 ? "1 sola domanda" : `${totalQuestions} domande (argomenti) diversi`;

    return [
      "Sei un tutor AI che interroga oralmente uno studente italiano.",
      "Contesto dello studente:",
      `- Materia: ${subjectText}`,
      `- Tipo di scuola: ${schoolText}`,
      `- Anno di corso: ${year}° anno`,
      `- Livello di difficolta' richiesto: ${difficultyText}`,
      `- Personalita' dell'esaminatore: ${personalityText}`,
      `- Argomento specifico da interrogare: "${topic}"`,
      notesBlock,
      "Se materia e tipo di scuola sono specificati, usa la tua conoscenza generale dei programmi scolastici italiani tipici per quel contesto per calibrare taglio, enfasi e linguaggio delle domande (il programma su un dato argomento puo' avere enfasi diverse tra un liceo classico, uno scientifico, un istituto tecnico, ecc.). Non hai accesso a internet in tempo reale: basati sulla tua conoscenza generale, senza inventare dettagli iper specifici o citare fonti che non conosci con certezza.",
      "Regole obbligatorie:",
      "- Fai UNA domanda alla volta, chiara, adatta a un'interrogazione orale (non troppo lunga).",
      "- Dopo ogni risposta corretta o sostanzialmente corretta dello studente, dai un feedback breve (massimo 2-3 frasi), poi fai la domanda successiva (nuovo argomento).",
      "- Se lo studente risponde in modo errato, incompleto o dice di non sapere: NON spiegare subito la risposta corretta e NON passare alla domanda successiva. Dagli invece un piccolo aiuto o indizio (senza rivelare la risposta) e ripeti/rilancia la STESSA domanda, eventualmente riformulata in modo piu' semplice o guidato. Puoi insistere cosi' su questa stessa domanda per un massimo di 3 tentativi complessivi. Se lo studente ci arriva durante questi tentativi, fagli un breve complimento e passa alla domanda successiva. Se dopo 3 tentativi ancora non ci arriva, non insistere oltre: in una sola frase sintetica dai tu la risposta corretta (cosi' impara qualcosa), poi passa alla domanda successiva.",
      "- Questi tentativi supplementari sulla stessa domanda NON contano come nuove domande: il conteggio delle domande totali avanza solo quando passi a un argomento davvero nuovo.",
      `- In totale devi fare ${questionsPhrase} sull'argomento "${topic}". Se sono piu' di una, le domande devono esplorare aspetti DIVERSI tra loro: non fare mai due domande simili o ripetitive. Alterna, per esempio, definizioni/concetti chiave, cause/conseguenze o meccanismi, esempi pratici o applicazioni concrete, collegamenti con altri argomenti o contesti, e un aspetto piu' critico o di ragionamento personale. Adatta anche il taglio delle domande alla materia (es. in una materia scientifica includi calcoli o applicazioni pratiche, in una materia umanistica includi analisi critica o contestualizzazione storica/culturale).`,
      `- Calibra la difficolta' delle domande e la profondita' attesa nelle risposte al livello indicato sopra (${difficulty}).`,
      `- Mantieni per tutta l'interrogazione la personalita' indicata sopra, sia nelle domande sia nei feedback.`,
      `- Dopo il feedback alla risposta dell'ultima domanda (la numero ${totalQuestions}), NON fare un'altra domanda: fornisci invece la valutazione finale, e SOLO quella, con questo formato esatto:`,
      "VALUTAZIONE FINALE",
      "Voto: X/10",
      "Punti da ripassare:",
      "- punto 1",
      "- punto 2",
      "- punto 3 (facoltativo)",
      "- Non aggiungere altro testo dopo la valutazione finale.",
      "- Rispondi sempre in italiano.",
      "- Le tue risposte verranno lette ad alta voce da un sintetizzatore vocale: non usare MAI notazione LaTeX, markdown, backslash o simboli come ^, _, \\frac, \\sqrt, asterischi per il grassetto. Scrivi ogni formula o simbolo matematico per esteso, in italiano colloquiale (es. 'x al quadrato' invece di x^2, 'la radice quadrata di 16' invece di \\sqrt{16}, 'due terzi' invece di 2/3, 'a fratto b' invece di \\frac{a}{b}).",
    ].join("\n");
  }

  if (supportsSynthesis) {
    // Alcuni browser popolano le voci in modo asincrono.
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
})();
