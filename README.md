# Orbit Ripetizioni — Interrogazione Orale AI (prototipo)

Prototipo di uno strumento che interroga oralmente uno studente su un
argomento a scelta, usando l'AI come esaminatore: fa domande a voce, ascolta
la risposta parlata, dà un breve feedback, e dopo circa 5 domande fornisce
una valutazione finale (voto 1-10 + punti da ripassare). La conversazione è
sempre visibile anche come trascrizione testuale a schermo.

## Come funziona

- **Frontend statico** (`index.html`, `css/style.css`, `js/app.js`):
  - Lo studente inserisce l'argomento (e opzionalmente appunti/testo di
    riferimento).
  - Il riconoscimento vocale (`SpeechRecognition`) e la sintesi vocale
    (`SpeechSynthesis`) usano le Web Speech API native del browser, in
    italiano (`it-IT`). Sono gratuite ma disponibili solo su alcuni browser
    (bene su Chrome/Edge; **Firefox e Safari non supportano
    `SpeechRecognition`**) — in quel caso l'interfaccia mostra
    automaticamente un campo di testo come fallback per rispondere.
  - Un indicatore di stato mostra se l'AI sta "ascoltando", "parlando" o
    "elaborando".
- **Funzione serverless** (`api/deepseek.js`):
  - Riceve dal frontend la cronologia della conversazione.
  - Inoltra la richiesta a DeepSeek (`https://api.deepseek.com/chat/completions`,
    modello `deepseek-chat`) aggiungendo la chiave API letta dalla variabile
    d'ambiente `DEEPSEEK_API_KEY`.
  - Restituisce al frontend solo il testo della risposta dell'AI.

**La chiave API DeepSeek non è mai presente nel codice frontend**: vive solo
lato server, come variabile d'ambiente su Vercel, e viene usata esclusivamente
dalla funzione serverless in `api/deepseek.js`. Aprendo "Ispeziona elemento"
nel browser non è in alcun modo visibile.

## Struttura del progetto

```
.
├── index.html          # pagina unica del prototipo
├── css/style.css        # stile navy/arancione
├── js/app.js             # logica: Web Speech API + chiamate a /api/deepseek
├── api/deepseek.js       # funzione serverless: proxy verso DeepSeek (chiave server-side)
├── package.json
├── .env.example          # esempio variabile d'ambiente per sviluppo locale
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
   - Nome: `DEEPSEEK_API_KEY`
   - Valore: la tua chiave API DeepSeek
   - Ambienti: seleziona **Production**, **Preview** e **Development** (tutte
     e tre le spunte), così la chiave è disponibile sia in produzione sia
     nelle preview di eventuali branch/PR.
   - Dopo aver aggiunto o modificato la variabile, fai un **redeploy** (le
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

`vercel dev` serve sia i file statici sia la funzione in `api/deepseek.js`
leggendo `DEEPSEEK_API_KEY` dal file `.env` locale.

## Note sul prototipo

- Il flusso prevede **5 domande** in totale; alla fine l'AI restituisce un
  voto indicativo da 1 a 10 e 2-3 punti da ripassare.
- Non c'è persistenza: ricaricando la pagina la conversazione si azzera.
- Non c'è integrazione con altri sistemi: è pensato per essere testato in
  isolamento come proof of concept.
