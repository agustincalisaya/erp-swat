import { writeFile } from "node:fs/promises";

const base = process.env.HU_G12_URL ?? "http://localhost:3006";
const tabs = await fetch("http://127.0.0.1:9228/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tabs.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let siguiente = 0;
const pendientes = new Map();
ws.onmessage = (event) => {
  const mensaje = JSON.parse(event.data);
  if (mensaje.method === "Runtime.exceptionThrown") console.error("Browser exception:", mensaje.params.exceptionDetails.text, mensaje.params.exceptionDetails.exception?.description);
  if (mensaje.method === "Runtime.consoleAPICalled" && mensaje.params.type === "error") console.error("Browser console:", mensaje.params.args.map((arg) => arg.value ?? arg.description));
  if (mensaje.id && pendientes.has(mensaje.id)) {
    const { resolve, reject } = pendientes.get(mensaje.id);
    pendientes.delete(mensaje.id);
    mensaje.error ? reject(Error(JSON.stringify(mensaje.error))) : resolve(mensaje.result);
  }
};
function comando(method, params = {}) {
  const id = ++siguiente;
  return new Promise((resolve, reject) => {
    pendientes.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluar(expression) {
  const resultado = await comando("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (resultado.exceptionDetails) throw Error(JSON.stringify(resultado.exceptionDetails));
  return resultado.result.value;
}
async function esperar(expression) {
  for (let intento = 0; intento < 80; intento++) {
    if (await evaluar(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(`No apareció: ${expression}`);
}
async function captura(archivo) {
  await evaluar("document.querySelector('nextjs-portal')?.remove()");
  const resultado = await comando("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(new URL(archivo, import.meta.url), Buffer.from(resultado.data, "base64"));
}

await comando("Page.enable");
await comando("Runtime.enable");
await comando("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
await comando("Page.navigate", { url: `${base}/login` });
await esperar("document.readyState === 'complete'");
const login = await evaluar(`fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:'admin.seed@erp-swat.local',password:'abc123456789'}) }).then(r => r.status)`);
if (login !== 200) throw Error(`Login HTTP ${login}`);
await comando("Page.navigate", { url: `${base}/tesoreria/categorias-gasto` });
await esperar("document.querySelector('h1')?.textContent === 'Categorías de gasto' && document.body.innerText.includes('Sueldos')");
await new Promise((resolve) => setTimeout(resolve, 2500));
await captura("./listado-activas.png");
await evaluar("document.querySelector('input[type=checkbox]').click()");
await esperar("document.body.innerText.includes('Prueba G12')");
await captura("./listado-con-inactivas.png");
await evaluar("Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Nueva categoría')).click()");
await esperar("document.querySelector('#categoria-nombre') !== null");
await captura("./formulario-alta.png");
const nombreUi = `Interfaz G12 ${Date.now()}`;
await evaluar("document.querySelector('#categoria-nombre').focus()");
await comando("Input.insertText", { text: nombreUi });
await evaluar("Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Guardar').click()");
await esperar(`document.body.innerText.includes(${JSON.stringify(nombreUi)})`);
ws.close();
console.log(`Capturas HU-G12: activas, inactivas y formulario. Alta desde Server Action: ${nombreUi}`);
