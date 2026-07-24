Questi file sono copiati (vendored) dal pacchetto npm
[`@mintplex-labs/piper-tts-web`](https://github.com/Mintplex-Labs/piper-tts-web)
versione 1.0.4, distribuito con licenza MIT.

Sono serviti come file statici da questo progetto (invece che tramite un CDN
come esm.sh/jsdelivr) per non dipendere da servizi di build/transpilazione
esterni, dato che il sito non ha una build step. Il pacchetto stesso, a
runtime nel browser, scarica separatamente:

- il runtime ONNX (`onnxruntime-web`) da cdnjs.cloudflare.com,
- il fonemizzatore WASM da cdn.jsdelivr.net (`@diffusionstudio/piper-wasm`),
- i modelli vocali (es. `it_IT-paola-medium`, ~63 MB) da huggingface.co
  (repo `diffusionstudio/piper-voices`).

Nessuna chiave API o account e' richiesto per nessuno di questi.
