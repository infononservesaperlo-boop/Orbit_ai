// Funzione serverless Vercel: proxy verso Microsoft Azure Speech (Text-to-Speech).
// Le chiavi restano lato server (variabili d'ambiente Vercel), non vengono
// mai esposte al frontend.

const MAX_TEXT_LENGTH = 5000;
// Voce neurale italiana di default; sovrascrivibile con la variabile
// d'ambiente AZURE_TTS_VOICE senza dover cambiare il codice.
const DEFAULT_VOICE = process.env.AZURE_TTS_VOICE || "it-IT-IsabellaNeural";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function getAccessToken(region, key) {
  const res = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Length": "0",
    },
  });
  if (!res.ok) {
    throw new Error(`Autenticazione Azure fallita (${res.status})`);
  }
  return res.text();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metodo non consentito" });
  }

  const apiKey = process.env.AZURE_TTS_KEY;
  const region = process.env.AZURE_TTS_REGION;
  if (!apiKey || !region) {
    return res.status(500).json({ error: "AZURE_TTS_KEY o AZURE_TTS_REGION non configurate sul server" });
  }

  const { text } = req.body || {};

  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Il campo 'text' e' obbligatorio" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "Testo troppo lungo per la sintesi vocale" });
  }

  try {
    const token = await getAccessToken(region, apiKey);

    const ssml =
      `<speak version='1.0' xml:lang='it-IT'>` +
      `<voice xml:lang='it-IT' name='${DEFAULT_VOICE}'>${escapeXml(text)}</voice>` +
      `</speak>`;

    const upstream = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": "OrbitRipetizioni",
      },
      body: ssml,
    });

    if (!upstream.ok) {
      const message = await upstream.text().catch(() => "");
      return res.status(upstream.status).json({ error: message || "Errore dall'API Azure Speech" });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const audioContent = Buffer.from(arrayBuffer).toString("base64");

    return res.status(200).json({ audioContent });
  } catch (err) {
    return res.status(500).json({ error: "Errore di comunicazione con Azure Speech" });
  }
};
