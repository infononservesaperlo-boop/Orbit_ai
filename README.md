# Orbit Ripetizioni — Interrogazione Orale AI (prototipo)

Prototipo di uno strumento che interroga oralmente uno studente su un
argomento a scelta, usando l'AI come esaminatore: fa domande a voce, ascolta
la risposta parlata, dà un breve feedback, e dopo circa 5 domande fornisce
una valutazione finale (voto 1-10 + punti da ripassare). La trascrizione
testuale della conversazione è disponibile a richiesta tramite il pulsante
"Trascrivi".

## Come funziona

- **Frontend statico** (`index.html`, `css/style.css`, `js/app.js`):
  - Lo studente sceglie materia, tipo di scuola, anno, difficoltà, argomento
    (e opzionalmente appunti/testo di riferimento).
  - Il riconoscimento vocale (`SpeechRecognition`) usa le Web Speech API
    native del browser, in italiano (`it-IT`). È gratuito ma disponibile
    solo su alcuni browser (bene su Chrome/Edge; **Firefox e Safari non
    supportano `SpeechRecognition`**) — in quel caso l'interfaccia mostra
    automaticamente un campo di testo come fallback per rispondere.
  - La voce dell'AI usa **Microsoft Azure Speech** (voce neurale italiana,
    molto più naturale della sintesi vocale nativa del browser) tramite
    `/api/tts`. Se la chiave non è configurata, la quota gratuita è esaurita
    o c'è un errore di rete, l'app torna automaticamente alla sintesi vocale
    nativa del browser (`SpeechSynthesis`) per non restare muta.
  - Un orb centrale con un'aura pulsante mostra visivamente se l'AI sta
    "parlando" (arancione) o se lo studente sta "parlando" (blu, reattiva al
    volume reale del microfono). Un pulsante "Trascrivi" mostra/nasconde la
    trascrizione testuale completa a richiesta.
- **Funzione serverless `api/deepseek.js`**:
  - Riceve dal frontend la cronologia della conversazione.
  - Inoltra la richiesta a DeepSeek (`https://api.deepseek.com/chat/completions`,
    modello `deepseek-chat`) aggiungendo la chiave API letta dalla variabile
    d'ambiente `DEEPSEEK_API_KEY`.
  - Restituisce al frontend solo il testo della risposta dell'AI.
- **Funzione serverless `api/tts.js`**:
  - Riceve dal frontend il testo da pronunciare.
  - Ottiene un token da Azure (`https://{regione}.api.cognitive.microsoft.com/sts/v1.0/issueToken`)
    usando `AZURE_TTS_KEY`, poi inoltra il testo (come SSML) all'endpoint di
    sintesi di Azure Speech (`https://{regione}.tts.speech.microsoft.com/cognitiveservices/v1`),
    con la regione letta da `AZURE_TTS_REGION`.
  - Restituisce al frontend l'audio in base64 (MP3), che viene riprodotto con
    un elemento `<audio>`.

**Le chiavi API non sono mai presenti nel codice frontend**: vivono solo lato
server, come variabili d'ambiente su Vercel, e vengono usate esclusivamente
dalle funzioni serverless in `api/`. Aprendo "Ispeziona elemento" nel browser
non sono in alcun modo visibili.

### Microsoft Azure Speech: come ottenere chiave e regione

1. Vai su [portal.azure.com](https://portal.azure.com/) e crea una risorsa
   **"Speech"** (cerca "Speech" tra i servizi Cognitive Services → Crea).
   ⚠️ Azure richiede un account con verifica (in genere carta di
   credito/debito) per creare la risorsa, anche restando nel piano gratuito
   — non viene addebitato nulla restando nel tier **F0 (Free)**.
2. Durante la creazione scegli il piano tariffario **F0 (gratuito)**: circa
   500.000 caratteri/mese con voci neurali, gratis per sempre entro quella
   soglia.
3. Annota la **regione** scelta in fase di creazione (es. `westeurope`,
   `northeurope`, `eastus`...): è il valore di `AZURE_TTS_REGION`.
4. A creazione completata, apri la risorsa → **"Chiavi ed endpoint"** nel
   menu laterale → copia **KEY 1**: è il valore di `AZURE_TTS_KEY`.

Se in futuro vuoi cambiare voce, la variabile opzionale `AZURE_TTS_VOICE`
(default `it-IT-IsabellaNeural`) accetta qualunque nome di voce neurale
`it-IT` elencato nella
[documentazione Azure](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts#supported-languages)
(es. `it-IT-DiegoNeural`, `it-IT-ElsaNeural`, `it-IT-GiuseppeMultilingualNeural`).

## Struttura del progetto

```
.
├── index.html          # pagina unica del prototipo
├── css/style.css        # stile navy/arancione
├── js/app.js             # logica: Web Speech API + chiamate a /api/deepseek e /api/tts
├── api/deepseek.js       # funzione serverless: proxy verso DeepSeek (chiave server-side)
├── api/tts.js            # funzione serverless: proxy verso Azure Speech TTS (chiave server-side)
├── package.json
├── .env.example          # esempio variabili d'ambiente per sviluppo locale
└── .gitignore            # esclude .env e .vercel dal repository
```

## Deploy su Vercel

1. **Importa il repository** su Vercel (New Project → seleziona questo repo).
2. **Framework Preset**: scegli **"Other"** (non è un progetto Next.js/React,
   è HTML/JS statico + una funzione serverless).
3. **Build Command**: lascialo **vuoto**.
4. **Output Directory**: imposta `.` (la root del progetto, dove si trova
   `index.html`).
5. **Variabili d'ambiente** (Project Settings → Environment Variables):
   - `DEEPSEEK_API_KEY` → la tua chiave API DeepSeek.
   - `AZURE_TTS_KEY` e `AZURE_TTS_REGION` → chiave e regione di Azure Speech
     (vedi sezione sopra). Se le ometti, l'app funziona comunque usando la
     voce nativa del browser come fallback.
   - `AZURE_TTS_VOICE` (opzionale) → nome di una voce `it-IT` alternativa.
   - Per ciascuna, seleziona **Production**, **Preview** e **Development**
     (tutte e tre le spunte), così è disponibile sia in produzione sia nelle
     preview di eventuali branch/PR.
   - Dopo aver aggiunto o modificato una variabile, fai un **redeploy** (le
     variabili d'ambiente vengono applicate solo ai deploy successivi alla
     modifica).
6. **⚠️ Controlla il "Production Branch"** (Project Settings → Git):
   - Verifica che il campo **"Production Branch"** sia impostato sul branch
     corretto di questo repository (quello con le modifiche di questo
     prototipo, es. `claude/orbit-ripetizioni-quiz-gfqxk1`, oppure il branch
     su cui verrà fatto merge, es. `main`).
   - Se il Production Branch punta al branch sbagliato, Vercel continuerà a
     pubblicare una versione vecchia (o vuota) del sito e la pagina nuova
     darà **404**, anche se il deploy sembra andato a buon fine — è già
     successo in un tentativo precedente, quindi ricontrollalo sempre dopo
     aver creato/collegato il progetto.
   - In alternativa, per testare rapidamente, usa l'URL del **Preview
     Deployment** generato automaticamente per il branch (visibile nella tab
     "Deployments" del progetto Vercel), che non dipende dal Production
     Branch.

## Sviluppo locale (opzionale)

Con [Vercel CLI](https://vercel.com/docs/cli) installata:

```bash
npm i -g vercel
cp .env.example .env   # poi inserisci la tua chiave in .env (mai committarlo)
vercel dev
```

`vercel dev` serve sia i file statici sia le funzioni in `api/deepseek.js` e
`api/tts.js`, leggendo le variabili dal file `.env` locale.

## Note sul prototipo

- Il flusso prevede **5 domande** in totale; alla fine l'AI restituisce un
  voto indicativo da 1 a 10 e 2-3 punti da ripassare.
- Non c'è persistenza: ricaricando la pagina la conversazione si azzera.
- Non c'è integrazione con altri sistemi: è pensato per essere testato in
  isolamento come proof of concept.
