// Funzione serverless Vercel: proxy verso Google Cloud Text-to-Speech.
// La chiave GOOGLE_TTS_API_KEY resta lato server (variabile d'ambiente
// Vercel), non viene mai esposta al frontend.

const TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const MAX_TEXT_LENGTH = 5000;
// Voce neurale italiana di default; sovrascrivibile con la variabile
// d'ambiente GOOGLE_TTS_VOICE senza dover cambiare il codice.
const DEFAULT_VOICE = process.env.GOOGLE_TTS_VOICE || "it-IT-Neural2-A";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metodo non consentito" });
  }

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GOOGLE_TTS_API_KEY non configurata sul server" });
  }

  const { text } = req.body || {};

  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Il campo 'text' e' obbligatorio" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "Testo troppo lungo per la sintesi vocale" });
  }

  try {
    const upstream = await fetch(`${TTS_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "it-IT", name: DEFAULT_VOICE },
        audioConfig: { audioEncoding: "MP3" },
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      const message = (data && data.error && data.error.message) || "Errore dall'API Google Text-to-Speech";
      return res.status(upstream.status).json({ error: message });
    }

    if (!data.audioContent) {
      return res.status(502).json({ error: "Risposta TTS vuota o inattesa" });
    }

    return res.status(200).json({ audioContent: data.audioContent });
  } catch (err) {
    return res.status(500).json({ error: "Errore di comunicazione con Google Text-to-Speech" });
  }
};
