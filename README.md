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
  - La voce dell'AI usa **Piper TTS** (voce italiana "Paola"), un motore di
    sintesi vocale neurale **open source ed eseguito interamente nel browser
    dello studente** via WebAssembly/ONNX Runtime — nessuna chiave API,
    nessun account cloud, nessun costo. I file della libreria sono in
    `vendor/piper-tts-web/` (vedi sotto); se per qualche motivo non si carica
    (browser non supportato, rete che blocca i CDN, ecc.) l'app torna
    automaticamente alla sintesi vocale nativa del browser (`SpeechSynthesis`)
    per non restare muta.
  - Un orb centrale con un'aura pulsante mostra visivamente se l'AI sta
    "parlando" (arancione) o se lo studente sta "parlando" (blu, reattiva al
    volume reale del microfono). Un pulsante "Trascrivi" mostra/nasconde la
    trascrizione testuale completa a richiesta.
- **Funzione serverless `api/deepseek.js`**:
  - Riceve dal frontend la cronologia della conversazione.
  - Inoltra la richiesta a DeepSeek (`https://api.deepseek.com/chat/completions`,
    modello `deepseek-v4-flash`) aggiungendo la chiave API letta dalla
    variabile d'ambiente `DEEPSEEK_API_KEY`.
  - Restituisce al frontend solo il testo della risposta dell'AI.

**La chiave DeepSeek non è mai presente nel codice frontend**: vive solo lato
server, come variabile d'ambiente su Vercel, e viene usata esclusivamente
dalla funzione serverless in `api/deepseek.js`. Aprendo "Ispeziona elemento"
nel browser non è in alcun modo visibile.

### Piper TTS: come funziona (nessuna configurazione richiesta)

Piper genera la voce **sul dispositivo dello studente**, non su un server:

1. Al primo utilizzo, il browser scarica il modello vocale "Paola"
   (**~63 MB**, una tantum) da Hugging Face, oltre al runtime ONNX
   (`cdnjs.cloudflare.com`) e al fonemizzatore (`cdn.jsdelivr.net`) — tutti
   servizi pubblici gratuiti, senza registrazione.
2. Il modello resta in cache sul dispositivo (Origin Private File System):
   le sessioni successive sullo stesso dispositivo/browser non lo riscaricano.
3. Il download del modello parte in background non appena si clicca "Inizia
   interrogazione", in parallelo con la prima domanda generata da DeepSeek,
   per non allungare i tempi di attesa percepiti.

Limiti da tenere presenti:
- Il primo utilizzo richiede scaricare ~63 MB: su una connessione dati lenta
  o limitata può richiedere qualche secondo/minuto la prima volta.
- Gira sulla CPU del dispositivo dello studente: su telefoni molto datati
  potrebbe essere più lento (ma il motore è comunque ottimizzato per girare
  piu' veloce del tempo reale anche su hardware modesto).
- Se la rete della scuola/casa blocca huggingface.co, cdnjs.cloudflare.com o
  cdn.jsdelivr.net, Piper non si carica e si passa automaticamente alla voce
  nativa del browser.

I file `vendor/piper-tts-web/*.js` sono copiati (vendored, non tramite CDN)
dal pacchetto npm `@mintplex-labs/piper-tts-web` (licenza MIT) — vedi
`vendor/piper-tts-web/NOTICE.md` per i dettagli e i servizi esterni usati a
runtime.

## Struttura del progetto

```
.
├── index.html                 # pagina unica del prototipo
├── css/style.css               # stile navy/arancione
├── js/app.js                    # logica: Web Speech API, Piper TTS, chiamate a /api/deepseek
├── api/deepseek.js              # funzione serverless: proxy verso DeepSeek (chiave server-side)
├── vendor/piper-tts-web/         # libreria Piper TTS (vendored, MIT, nessuna chiave richiesta)
├── assets/orbit-mark.png         # logo
├── package.json
├── .env.example                  # esempio variabili d'ambiente per sviluppo locale
└── .gitignore                    # esclude .env e .vercel dal repository
```

## Deploy su Vercel

1. **Importa il repository** su Vercel (New Project → seleziona questo repo).
2. **Framework Preset**: scegli **"Other"** (non è un progetto Next.js/React,
   è HTML/JS statico + una funzione serverless).
3. **Build Command**: lascialo **vuoto**.
4. **Output Directory**: imposta `.` (la root del progetto, dove si trova
   `index.html`).
5. **Variabili d'ambiente** (Project Settings → Environment Variables):
   - `DEEPSEEK_API_KEY` → la tua chiave API DeepSeek. Seleziona **Production**,
     **Preview** e **Development** (tutte e tre le spunte), così è disponibile
     sia in produzione sia nelle preview di eventuali branch/PR.
   - Non serve nessun'altra variabile: la voce (Piper TTS) gira nel browser
     dello studente, senza chiavi.
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

`vercel dev` serve sia i file statici sia la funzione in `api/deepseek.js`,
leggendo `DEEPSEEK_API_KEY` dal file `.env` locale.

## Note sul prototipo

- Il numero di domande (1-5, default 1), la difficoltà e la personalità
  dell'esaminatore sono selezionabili prima di iniziare; alla fine l'AI
  restituisce un voto indicativo da 1 a 10 e 2-3 punti da ripassare.
- Non c'è persistenza: ricaricando la pagina la conversazione si azzera.
- Non c'è integrazione con altri sistemi: è pensato per essere testato in
  isolamento come proof of concept.
