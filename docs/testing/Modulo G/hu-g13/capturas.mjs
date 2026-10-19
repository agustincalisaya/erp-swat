import { writeFile } from "node:fs/promises";

const tab = await fetch("http://127.0.0.1:9228/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let secuencia = 0;
const pendientes = new Map();
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pendientes.has(data.id)) {
    const { resolve, reject } = pendientes.get(data.id);
    pendientes.delete(data.id);
    data.error ? reject(Error(JSON.stringify(data.error))) : resolve(data.result);
  }
};
function enviar(method, params = {}) {
  const id = ++secuencia;
  return new Promise((resolve, reject) => { pendientes.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluar(expression) {
  const r = await enviar("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function esperar(expression) {
  for (let n = 0; n < 100; n++) {
    if (await evaluar(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(`No apareció: ${expression}; estado: ${await evaluar("JSON.stringify({url:location.href,text:document.body.innerText.slice(-1000)})")}`);
}
async function captura(archivo) {
  await evaluar("document.querySelector('nextjs-portal')?.remove()");
  const r = await enviar("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(new URL(archivo, import.meta.url), Buffer.from(r.data, "base64"));
}
await enviar("Page.enable"); await enviar("Runtime.enable");
await enviar("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
await enviar("Page.navigate", { url: "http://localhost:3006/login" });
await esperar("document.readyState === 'complete'");
const login = await evaluar(`fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:'tesorero.seed@erp-swat.local',password:'abc123456789'}) }).then(r => r.status)`);
if (login !== 200) throw Error(`Login HTTP ${login}`);
await enviar("Page.navigate", { url: "http://localhost:3006/tesoreria/gastos-operativos" });
await esperar("document.querySelector('h1')?.textContent === 'Gastos operativos' && !!document.querySelector('#gastos-mes')");
await esperar("!document.body.innerText.includes('Cargando gastos…') && document.body.innerText.includes('gastos') && document.body.innerText.includes('TOTAL DEL PERÍODO FILTRADO')");
await captura("./listado.png");
await evaluar("Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Nuevo gasto'))?.click()");
await esperar("document.querySelector('#gasto-categoria') !== null");
await captura("./formulario-alta.png");
const descripcion = `Interfaz G13 ${Date.now()}`;
await evaluar("document.querySelector('#gasto-monto').focus()");
await enviar("Input.insertText", { text: "42.50" });
await evaluar("document.querySelector('#gasto-descripcion').focus()");
await enviar("Input.insertText", { text: descripcion });
await evaluar("Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Guardar')?.click()");
await esperar(`document.body.innerText.includes(${JSON.stringify(descripcion)})`);
ws.close();
console.log(`Capturas HU-G13: listado y formulario; alta por Server Action: ${descripcion}`);
