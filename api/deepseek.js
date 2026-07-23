// Funzione serverless Vercel: proxy verso DeepSeek.
// La chiave DEEPSEEK_API_KEY resta lato server (variabile d'ambiente Vercel),
// non viene mai esposta al frontend.

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 8000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metodo non consentito" });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "DEEPSEEK_API_KEY non configurata sul server" });
  }

  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Il campo 'messages' è obbligatorio ed è un array" });
  }

  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: "Conversazione troppo lunga" });
  }

  for (const m of messages) {
    if (
      !m ||
      typeof m.content !== "string" ||
      !["system", "user", "assistant"].includes(m.role) ||
      m.content.length > MAX_CONTENT_LENGTH
    ) {
      return res.status(400).json({ error: "Formato messaggi non valido" });
    }
  }

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // "deepseek-chat" viene dismesso il 24/07/2026: deepseek-v4-flash e'
        // il modello che lo sostituisce (stessa modalita' "non-thinking").
        model: "deepseek-v4-flash",
        messages,
        temperature: 0.7,
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      const message = (data && data.error && data.error.message) || "Errore dall'API DeepSeek";
      return res.status(upstream.status).json({ error: message });
    }

    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    if (!reply) {
      return res.status(502).json({ error: "Risposta AI vuota o inattesa" });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: "Errore di comunicazione con DeepSeek" });
  }
};
