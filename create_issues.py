#!/usr/bin/env python3
"""
Crea los 20 issues del code review en sssamuelll/component-snap.

Uso:
    GITHUB_TOKEN=ghp_xxx python3 create_issues.py
    GITHUB_TOKEN=ghp_xxx python3 create_issues.py --dry-run   # solo imprime
    GITHUB_TOKEN=ghp_xxx python3 create_issues.py --start 5   # empieza desde el #5

Requiere Python 3.8+. Sin dependencias externas.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

REPO = "sssamuelll/component-snap"
API = f"https://api.github.com/repos/{REPO}/issues"

ISSUES = [
    # ---------- 🔴 CRÍTICOS ----------
    (
        "[Crítico] `keyframes` se emite como CSS basura en el export del capsule",
        """## Severidad
🔴 Crítico

## Ubicación
- `src/cdp/portableExtraction.ts:107-110`
- `src/cdp/types.ts:340`
- `src/cdp/cssCaptureNormalization.ts:421`

## Problema
El tipo declara `keyframes?: string[]` y la normalización guarda allí **nombres de animaciones** (`'spin'`, `'fade'`), no las reglas `@keyframes`:

```ts
// cssCaptureNormalization.ts:421
keyframes: keyframeResult.names,
```

Pero el serializador del capsule las trata como si fueran texto de regla CSS:

```ts
// portableExtraction.ts:107-110
for (const keyframes of asArray(cssGraph.keyframes)) {
  if (!keyframes?.trim()) continue
  css += `${keyframes.trim()}\\n\\n`
}
```

## Por qué importa
El export portable del tier `capsule` pone literalmente las palabras `spin\\n\\nfade` en el `.css`. Es CSS sintácticamente inválido y, peor, **ninguna `@keyframes` real llega al export**. El browser descarta esos tokens silenciosamente como parse error, así que la animación se pierde sin warning visible.

Esto invalida la promesa del tier `capsule`: el tier `fallback` sí captura keyframes reales (`extractor.ts:578-588`), mientras que el tier supuestamente superior no.

## Propuesta
Cambiar la estructura para que `keyframes` capture el `cssText` real:

```ts
keyframes?: Array<{ name: string; cssText: string }>
```

Capturar el texto usando CDP `CSS.getStyleSheetText` sobre los `styleSheetId` de las matched rules, parsear/filtrar `@keyframes` por nombre, y emitir `cssText` en el serializador.

Alternativa mínima: eliminar el loop en `portableExtraction.ts:107-110` y registrar un warning explícito `replay-capsule-keyframes-not-supported`.

## Cómo verificar el fix
Test que parseé el output: `expect(() => new CSSStyleSheet().replace(serializedCss)).not.toThrow()` para un cssGraph con keyframes.
""",
    ),
    (
        "[Crítico] `domSnapshot.stats.nodes` cuenta el string table, no nodos",
        """## Severidad
🔴 Crítico

## Ubicación
- `src/cdp/domSnapshotCapture.ts:19`

## Problema
```ts
return {
  raw,
  stats: {
    documents: raw.documents?.length ?? 0,
    nodes: raw.strings?.length ?? 0,   // ← BUG
  },
}
```

`DOMSnapshot.captureSnapshot` devuelve `strings` como tabla **deduplicada** de cadenas (atributos, valores), no nodos. El conteo real de nodos vive en `documents[].nodes.parentIndex.length` (o estructura equivalente).

## Por qué importa
`fidelityScoring.ts:286-287` lee este número como `structure-dom-nodes:${domNodeCount}` y suma puntos al score estructural. Casi cualquier página devuelve cientos/miles de strings, así que la métrica está siempre "infladamente verde" — el score estructural reportado no mide lo que dice.

Esto contamina los reportes del benchmark y `meta.json` de cada export.

## Propuesta
```ts
nodes: Array.isArray(raw.documents) && raw.documents[0]?.nodes?.parentIndex
  ? raw.documents[0].nodes.parentIndex.length
  : 0,
```

O renombrar el campo a `stringTableSize` y dejar de fingir que es un conteo de nodos.

## Cómo verificar el fix
Test que mockee un `DOMSnapshot` con `strings: ['a','b','c']` y `documents: [{ nodes: { parentIndex: [0,1,2,3,4,5,6,7] } }]` y assertee que `stats.nodes === 8`, no `3`.
""",
    ),
    (
        "[Crítico] Estado del service worker se pierde — captures fantasma sin CDP",
        """## Severidad
🔴 Crítico

## Ubicación
- `src/background.ts:92-93` (`activeRequests`, `debugLog` como variables de módulo)
- `src/background.ts:116-118` (constantes de build)
- `src/background.ts:414` (skip silencioso de CDP capture)

## Problema
```ts
const activeRequests = new Map<string, number>()
const debugLog: DebugEvent[] = []
```

En MV3, el service worker es **reclamado tras ~30 s de inactividad**. Entre `START_INSPECT_TAB` y el click del usuario (hover + decisión) pueden pasar minutos. Cuando llega el mensaje `ELEMENT_SELECTED`, si el SW murió y resucitó, `activeRequests.get(message.requestId)` devuelve `undefined`.

Entonces este bloque se ejecuta **sin** `tabId`:

```ts
// background.ts:414
if (tabId) {
  try {
    cdpCapture = await runCDPCapture(...)
    ...
```

El `if (tabId)` se evalúa false → `cdpCapture` queda como `undefined` → el snap se guarda con `exportTier: 'fallback'` y sin diagnóstico de error visible al usuario.

## Por qué importa
El path principal del producto (replay-first, tier `capsule`) **falla silenciosamente** en su uso natural: "abre el picker, navega, busca un componente, clic". Convierte el fallback en el camino feliz sin que nadie se entere. El producto vende `capsule` y entrega `fallback`.

## Propuesta
Persistir `activeRequests` en `chrome.storage.session` (efímero pero sobrevive al reciclaje del SW):

```ts
const registerActiveRequest = async (requestId: string, tabId: number) => {
  const { activeRequests = {} } = await chrome.storage.session.get(['activeRequests'])
  activeRequests[requestId] = tabId
  await chrome.storage.session.set({ activeRequests })
}

const popActiveRequest = async (requestId: string): Promise<number | undefined> => {
  const { activeRequests = {} } = await chrome.storage.session.get(['activeRequests'])
  const tabId = activeRequests[requestId]
  delete activeRequests[requestId]
  await chrome.storage.session.set({ activeRequests })
  return tabId
}
```

Como cinturón adicional: cuando `tabId` falte, emitir un warning visible (`exportDiagnostics.cdpError = 'sw-recycled-no-tab-id'`) en vez de pasar de largo.

## Cómo verificar el fix
Test (manual o e2e) que simule reciclaje del SW: `chrome.runtime.reload()` o esperar inactividad, luego ELEMENT_SELECTED → assertee que `cdpCapture` está presente o que el warning es explícito.
""",
    ),
    (
        "[Crítico] `chrome.storage.local.clear()` antes de cada `set` borra todo el storage",
        """## Severidad
🔴 Crítico

## Ubicación
- `src/background.ts:501-510`

## Problema
```ts
await chrome.storage.local.clear()

await chrome.storage.local.set({
  lastSelection: {
    ...enrichedPayload,
    snapFolder: folder,
    requestId: message.requestId,
    snappedAt: new Date().toISOString()
  }
})
```

`chrome.storage.local.clear()` borra **todo** el storage local de la extensión, no solo `lastSelection`. Y `set` ya es upsert, así que el `clear` no aporta nada a la operación pretendida.

## Por qué importa
Hoy parece inocuo porque solo se guarda `lastSelection`. Pero en cuanto se añadan settings de usuario, history de capturas, baselines de pixel-diff, feature flags, o cualquier otro estado persistente → cada captura los borra. Es una bomba de tiempo silenciosa.

## Propuesta
Eliminar la línea 501:

```ts
await chrome.storage.local.set({
  lastSelection: { ... }
})
```

Si la intención era limpiar campos viejos específicos de `lastSelection`, escribir el objeto completo ya los sobrescribe. Si hubiera otros campos efímeros que invalidar, usar `chrome.storage.local.remove(['campo1', 'campo2'])` explícito.

## Cómo verificar el fix
Test:
```ts
await chrome.storage.local.set({ userSettings: { theme: 'dark' } })
await saveSnapFiles(payload)   // dispara la lógica
const { userSettings } = await chrome.storage.local.get(['userSettings'])
expect(userSettings).toEqual({ theme: 'dark' })
```
""",
    ),
    # ---------- 🟠 ALTOS ----------
    (
        "[Alto] Runtime resolver ejecuta la misma expresión dos veces — race de identidad de nodo",
        """## Severidad
🟠 Alto

## Ubicación
- `src/cdp/nodeResolverRuntime.ts:381-385` (primera `Runtime.evaluate`)
- `src/cdp/nodeResolverRuntime.ts:401-405` (segunda `Runtime.evaluate` con la misma expresión)

## Problema
Primero `Runtime.evaluate({ returnByValue: true })` para obtener el summary serializable; después una segunda `Runtime.evaluate({ returnByValue: false })` con la **misma expresión** para obtener el remote object del winner. Entre ambas llamadas la página puede mutar (lo normal en SPAs con hover, scroll, ResizeObserver, etc.).

## Por qué importa
1. El `confidence`, `evidence` y `topCandidates` reportados pueden no describir el nodo realmente devuelto: el "best" de la primera evaluación puede no ser el mismo nodo que la segunda. El reporte miente sobre qué se mapeó.
2. Se paga **doble** el costo de un scoring que itera `document.querySelectorAll(tag)` con scoring por elemento — caro en páginas con miles de nodos.
3. Las dos evaluaciones no son atómicas: ni transacción ni snapshot. No hay forma de garantizar coherencia sin un solo evaluate.

## Propuesta
Una sola `Runtime.evaluate({ returnByValue: false })` que guarde el winner en un objectGroup CDP y retorne el summary embebido:

```ts
// expression
const result = (() => { ... compute scoring ... })()
window.__csnap_picked = result.best.element
return { summary: result.summary }  // serializable
// ↑ pero result.best.element queda accesible via DOM.requestNode
```

Luego `DOM.requestNode({ objectId })` sobre `result` para extraer el nodeId. O usar `objectGroup: 'csnap'` y `Runtime.releaseObjectGroup` al final.

## Cómo verificar el fix
Métrica: tiempo de mapeo en página grande (Reddit homepage) debería bajar ~50%. Test de integración con mutationObserver inyectando mutaciones entre evaluates → no debería cambiar el resultado.
""",
    ),
    (
        "[Alto] Inline `style` se borra antes de que la detección de \"scene\" pueda verlo",
        """## Severidad
🟠 Alto

## Ubicación
- `src/cdp/targetSubtree.ts:30-64` (`ALLOWED_ATTRS` sin `'style'`)
- `src/cdp/targetSubtreeNormalization.ts:301-335` (`getStyleAttr`, `hasScenePositioningStyle`)

## Problema
`materializeSubtree` en `targetSubtree.ts` filtra atributos por whitelist y `'style'` no está incluido. Cuando la normalización corre después:

```ts
// targetSubtreeNormalization.ts:301
const getStyleAttr = (attrs) => (attrs?.style || '').toLowerCase()
```

`attrs.style` siempre es `''` porque ya fue stripped. Toda la heurística posterior (`hasScenePositioningStyle` con sus chequeos de `position:absolute`, `transform:`, `translate(...)`, `width:`, `height:`, etc.) es **código muerto** en el path normal de captura.

## Por qué importa
El sistema entero (manifesto, EPIC v2) declara que necesita preservar escenas con primitivas posicionadas (Lichess board, charts, canvas-likes). Pero la señal principal de "esto es una escena" nunca llega al normalizador. Las escenas se detectan únicamente por nombre de tag custom (`piece`, `cg-board`) o por tokens de clase ("board", "piece").

Funciona en Lichess de casualidad porque tiene `cg-board`. Cualquier escena hecha con `<div style="position:absolute">` (la mitad de los charts, dashboards, editores visuales) **no se detecta como escena**.

## Propuesta
Agregar `'style'` a `ALLOWED_ATTRS` en `targetSubtree.ts:33-64`:

```ts
const ALLOWED_ATTRS = new Set([
  'id', 'class', 'role', 'style',  // ← añadir
  ...
])
```

O, si se mantiene la decisión de strippear `style` por tamaño, eliminar todo `hasScenePositioningStyle`, `getStyleAttr`, e `isMeaningfulEmptySceneElement` (cuya lógica también depende de `style`) y documentar: "detección de escenas solo por tag/clase".

## Cómo verificar el fix
Test con HTML como `<div style="position:absolute;transform:translate(40px,40px)">` × 6 hermanos → `analyzeSceneLikeSubtree` debería retornar `sceneLike: true`.
""",
    ),
    (
        "[Alto] Policy específica de tres sitios incrustada en el motor genérico",
        """## Severidad
🟠 Alto

## Ubicación
- `src/cdp/portableExtraction.ts:261, 272-291, 293-301, 303-310, 322-336, 348-422` (~250 líneas)
- `src/content.ts:111-167` (`getSearchShellScore`, `SEARCH_PREFERRED_CLASS_TOKENS`)
- `src/cdp/targetSubtreeNormalization.ts:149-150` (`SEARCH_ROOT_CLASS_TOKENS`, `SEARCH_DISCARD_CLASS_TOKENS`)

## Problema
Hay strings hardcodeados de tres sitios específicos en el "motor genérico":

- **Google**: `RNNXgb`, `A8SBwf`, `glfyf`, `oMByyf`, `plR5qb`, `UbbAWe`, `XOUhue`, `Y5MKCd`, `FHRw9d`, y mensajes de error UI en alemán ("Dateianhang entfernen", "KI‑Modus")
- **Reddit**: `faceplate-tracker`, `rpl-tooltip`, `activate-feature`, `search-dynamic-id-cache-controller`
- **Lichess**: `cg-board`, `cg-wrap`, `cg-container`, `puzzle__board`, `main-board`

`pickExportSubtreeHtml` es un árbol de `if/else` por subtype donde cada rama propaga razones como warnings (`'class-policy:board-like-prefers-framed-target'`, `'class-policy:search-like-prefers-wrappered-target'`).

## Por qué importa
1. **Cobertura del benchmark = sitios hardcodeados**. El benchmark mide exactamente los tres sitios cuyas clases están bakeadas en el código. Es self-fulfilling: por construcción pasa, por construcción no generaliza.
2. **Bit rot inevitable**. Los class tokens minificados de Google rotan con cada despliegue (`RNNXgb` hoy, `XyZ123` mañana). Cuando se rompa, no hay alerta — degrada silenciosamente.
3. **El motor pretende ser general**. Cualquier sitio fuera de Google/Reddit/Lichess está en el "happy path por defecto" y nadie ha probado que se comporte razonablemente.

## Propuesta
Extraer la policy a una tabla declarativa keyed por dominio + targetClass:

```ts
// src/cdp/siteAdapters.ts
export const SITE_ADAPTERS = [
  {
    match: /google\\./,
    searchShellClasses: ['rnnxgb', 'a8sbwf'],
    discardClasses: ['omByyf', 'ubbAWe', ...],
    discardAriaLabels: [/datei.*hochladen/i, ...],
  },
  ...
]
```

Y que `portableExtraction.ts` consuma esta tabla sin saber de Google/Reddit/Lichess. Si después se demuestra que la generalización falla, al menos la dependencia es explícita y testeable.

## Cómo verificar el fix
- Cero referencias a class tokens de sites en `src/cdp/portableExtraction.ts` (grep: `RNNXgb|A8SBwf|cg-board|faceplate-`).
- Tests por adaptador en lugar de tests de la función global.
""",
    ),
    (
        "[Alto] Build provenance hardcodeada como literal de fuente — `meta.json` miente",
        """## Severidad
🟠 Alto

## Ubicación
- `src/background.ts:116-118`

## Problema
```ts
const PIPELINE_VERSION = 'observability-v1'
const BUILD_COMMIT_SHA = '85b8cae'
const BUILD_TIMESTAMP = '2026-03-11T17:02:38+01:00'
```

Estos valores se inyectan en cada `meta.json` exportado (líneas 274-278) como "provenance del build". Pero están **hardcodeados en el fuente** — un build hecho hoy con cambios locales sigue reportando ese commit y timestamp.

## Por qué importa
El principio declarado del epic v2 (`EPIC_RUNTIME_TWIN_V2.md:385`): *"If the system cannot preserve truth, it must preserve evidence."*

La pieza más visible de evidencia/provenance (qué build produjo este export) es una **mentira congelada**. Imposible debuggear "este export está roto, ¿qué build lo hizo?" si todos los exports reportan el mismo commit.

## Propuesta
Inyectar al build via `vite.config.ts`:

```ts
import { execSync } from 'node:child_process'

const commitSha = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() }
  catch { return 'unknown' }
})()

export default defineConfig({
  define: {
    __BUILD_COMMIT_SHA__: JSON.stringify(commitSha),
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
    __PIPELINE_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
})
```

Y en `background.ts`:
```ts
declare const __BUILD_COMMIT_SHA__: string
declare const __BUILD_TIMESTAMP__: string
declare const __PIPELINE_VERSION__: string
```

Si el commit no se puede resolver (no hay git), reportar `'unknown'` en vez de un valor que finge ser real.

## Cómo verificar el fix
Construir dos veces con cambios distintos → los `meta.json` deben tener commit sha diferente.
""",
    ),
    (
        "[Alto] Doble captura de screenshot (Chrome tabs API + CDP) — duplica trabajo y compite",
        """## Severidad
🟠 Alto

## Ubicación
- `src/background.ts:408` (`chrome.tabs.captureVisibleTab`) + crop por OffscreenCanvas (líneas 178-203)
- `src/cdp/pageCapture.ts:8-35` (`Page.captureScreenshot` x2: full + clip)

## Problema
El pipeline toma **tres** screenshots por captura, en tres momentos distintos:

1. `chrome.tabs.captureVisibleTab({ format: 'png' })` → croppeado por OffscreenCanvas → `screenshot.png` que ve el usuario.
2. `Page.captureScreenshot()` full → guardado en `replayCapsule.snapshot.screenshot.fullPageDataUrl`.
3. `Page.captureScreenshot({ clip: ... })` → `replayCapsule.snapshot.screenshot.clipDataUrl`.

Como suceden en distintos momentos (separados por await), la página puede haber animado o re-layouteado entre uno y otro.

## Por qué importa
1. **Latencia y memoria**. Tres encodes PNG, dos buffers en el SW (donde la memoria es escasa). En páginas pesadas el SW puede quedarse sin memoria.
2. **Source of truth inconsistente**. El usuario ve el screenshot #1. El benchmark compara baseline contra el #3. El visor del popup muestra el #2/#3. Tres versiones de "la verdad", todas ligeramente distintas.
3. **`captureVisibleTab` es menos confiable**. Falla en pestañas inactivas; CDP `Page.captureScreenshot` no.

## Propuesta
Tomar solo el CDP clip y derivar lo que el usuario ve del mismo buffer:

```ts
// background.ts ELEMENT_SELECTED
const cdpCapture = await runCDPCapture(seed)   // ya hace los dos CDP shots
if (cdpCapture?.screenshot?.clipDataUrl) {
  message.payload.element.screenshotDataUrl = cdpCapture.screenshot.clipDataUrl
}
// eliminar la rama de captureVisibleTab + cropDataUrl
```

Si CDP no está disponible (escenario de fallback), entonces y solo entonces caer a `captureVisibleTab`.

## Cómo verificar el fix
- `grep "captureVisibleTab" src/` → solo aparece en la rama de fallback.
- El `screenshot.png` del export y el `clipDataUrl` del capsule deben ser byte-idénticos.
""",
    ),
    # ---------- 🟡 MEDIOS ----------
    (
        "[Medio] `extractPortableFallbackSubtree` confía en alineación frágil por índice entre dos walks",
        """## Severidad
🟡 Medio

## Ubicación
- `src/portableFallback/extractor.ts:251-270` (`walkUnified` vs `deepCloneAndFlatten`)
- `src/portableFallback/extractor.ts:461-475` (zip por índice)
- `src/portableFallback/extractor.ts:514-516` (`originalNodes[index]` ↔ `clonedNodes[index]`)

## Problema
El extractor zipea por índice posicional dos walks distintos:

```ts
// linea 462-466
walkUnified(root, (node) => { originalNodes.push(node) })

// linea 469-475
const walkClone = (node) => { ... clonedNodes.push(node) ... }
walkClone(clone)

// linea 514-516
for (let index = 0; index < clonedNodes.length; index++) {
  const node = clonedNodes[index]
  const original = originalNodes[index]
  ...
}
```

Hoy coinciden porque ambos recorren primero los hijos del shadowRoot y luego los childNodes. Pero el contrato vive en la cabeza de quien escribió `walkUnified` y `deepCloneAndFlatten` — **no hay assertion** ni tag/checksum cruzado.

Cualquier futura tweak en el orden de recorrido (por ejemplo, cambiar shadow-first a shadow-last, o saltarse algún tipo de nodo en un walk pero no en el otro) alinea el CSS al nodo equivocado de manera **silenciosa**. El export se ve "casi bien" pero los estilos están desplazados.

## Por qué importa
Bug invariante-por-coincidencia. El día que cambien `walkUnified` o `deepCloneAndFlatten` y los tests pasen, el export visual se romperá en producción de una forma difícil de diagnosticar (no crashea, solo "se ve raro").

## Propuesta
Construir un único `Array<{ original, clone }>` en un solo walk emparejado:

```ts
const pairs: Array<{ original: Element; clone: Element }> = []

const cloneAndCollect = (node: Node): Node => {
  const clone = node.cloneNode(false)
  if (node instanceof HTMLElement || node instanceof SVGElement) {
    pairs.push({ original: node, clone: clone as Element })
    if (node.shadowRoot) {
      for (const child of node.shadowRoot.childNodes) clone.appendChild(cloneAndCollect(child))
    }
  }
  for (const child of node.childNodes) clone.appendChild(cloneAndCollect(child))
  return clone
}
```

Y consumir `pairs` en vez de zipear por índice.

## Cómo verificar el fix
Test que inserte un shadowRoot con orden no trivial (intercalado), capture, verifique que `getComputedStyle(original)` y los estilos serializados para `clone` coinciden para cada par.
""",
    ),
    (
        "[Medio] `getDefaultStyles` crea/destruye iframe por tag sin guardarrail real",
        """## Severidad
🟡 Medio

## Ubicación
- `src/portableFallback/extractor.ts:332-367`

## Problema
```ts
const getDefaultStyles = (tagName: string): Record<string, string> => {
  const key = tagName.toLowerCase()
  if (defaultStylesCache.has(key)) return defaultStylesCache.get(key)!

  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { visibility: 'hidden', width: '0', height: '0', position: 'absolute' })
  document.body.appendChild(iframe)
  ...
  document.body.removeChild(iframe)   // siempre, incluso si doc fue null
  defaultStylesCache.set(key, styles)
  return styles
}
```

El cache mitiga ejecuciones repetidas, pero la **primera** captura sobre un subtree con tags variados (50+ tags HTML/SVG distintos en Reddit, Google, etc.) ejecuta 50 inserciones DOM síncronas, cada una con `iframe.contentWindow.getComputedStyle(temp)` × ~60 propiedades → forzar layout.

Adicionalmente, `document.body.removeChild(iframe)` se ejecuta sin importar si `doc` fue null o si hubo error en medio.

## Por qué importa
- Captura de página pesada (Reddit, Twitter) bloquea el hilo del content script durante cientos de milisegundos.
- El `defaultStylesCache` es por-página (no persiste), así que cada navegación paga el costo de nuevo.
- La aproximación tipo "spawn iframe → measure → destroy" es fragile contra políticas CSP que bloqueen iframes inline.

## Propuesta
Una de dos:

**A) Hoja precomputada de UA defaults.** Hay listings públicos del W3C/MDN de los defaults por tag. Embeber un JSON estático con los defaults relevantes para los ~30 tags comunes. Cero DOM work.

**B) Iframe único persistente y compartido.** Crear UN iframe oculto al primer uso, reutilizarlo para todos los tags, nunca destruirlo. Coste fijo en vez de O(tags).

## Cómo verificar el fix
Profilear una captura de Reddit homepage antes/después. El tiempo en `getDefaultStyles` debería bajar de ~300 ms a <10 ms.
""",
    ),
    (
        "[Medio] `scoreCaptureFidelity` tiene policy de tres sitios escondida en los pesos",
        """## Severidad
🟡 Medio

## Ubicación
- `src/cdp/fidelityScoring.ts:440-506`

## Problema
Bloques como estos viven en el scorer "genérico":

```ts
// 447-451
if (targetSubtypeHint === 'board-like') {
  overallScore = Math.max(overallScore, Math.min(portableConfidence, 0.64))
  overallConfidence = Math.max(overallConfidence, Math.min(portableConfidence, 0.62))
  notes.unshift('class-policy:board-like-scene-tolerance')
}

// 487-491
if (targetClassHint === 'semantic-shell' && targetSubtypeHint === 'search-like') {
  overallScore = Math.max(overallScore, Math.min(portableConfidence, 0.66))
  overallConfidence = Math.max(overallConfidence, Math.min(portableConfidence, 0.62))
  notes.unshift('class-policy:search-like-shell-preservation')
}
```

Hay ~10 cláusulas de este tipo que empujan el score hacia arriba/abajo según subtype con constantes mágicas (0.64, 0.66, 0.58, 0.42, 0.28...). El score resultante es **no-monotónico**: agregar más evidencia puede bajar el score si activa una clausula de "fragile".

## Por qué importa
El "fidelity score" pierde significado: no mide qué tan fiel es la captura, mide **qué tan tolerante es el scorer hacia ese tipo de target**. Imposible de auditar sin trazar manualmente. Difícil de mover (cualquier cambio rompe los tests del benchmark).

## Propuesta
Separar dos números en `meta.json`:

```ts
{
  rawScore: { score, confidence },        // dimensiones + pixelDiff, sin policy
  policyAdjustedScore: { score, confidence, adjustments: [...] },  // con razones explícitas
}
```

`rawScore` se calcula sin nada de "class-policy:*". `policyAdjustedScore` aplica las cláusulas con un `adjustments` array que liste `{ rule: 'board-like-floor', from: 0.31, to: 0.58 }`. Así se puede auditar qué empujó qué.

Como paso siguiente, mover esos pisos/techos a constantes nombradas en un módulo `fidelityPolicy.ts`.

## Cómo verificar el fix
Test de no-monotonía: agregar un nuevo `evidence` a un capsule no debería *bajar* el score. Hoy ese test falla.
""",
    ),
    (
        "[Medio] Versionado divergente entre package.json, manifest y README",
        """## Severidad
🟡 Medio

## Ubicación
- `package.json:4` → `"version": "0.0.0"`
- `src/manifest.ts:6` → `version: '0.0.1'`
- `README.md` y `ISSUES.md:3` mencionan "iteraciones v0.0.1 a v0.0.8"

## Problema
Tres fuentes de verdad para la versión del producto, ninguna refleja la realidad (el README habla de v0.0.8 mientras los manifests dicen 0.0.0/0.0.1).

## Por qué importa
- El usuario que abre `chrome://extensions` ve "0.0.1" — desactualizado.
- `package.json` se queda en `0.0.0` para siempre — usaste el default de `npm init`.
- La narrativa del README sugiere madurez ("v0.0.8") que el código no refleja.
- Para reportes/bug-reports/crash dumps no hay una versión confiable.

## Propuesta
Una sola fuente de verdad — `package.json` — y `manifest.ts` la lee:

```ts
// vite.config.ts o manifest.ts
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  ...
  version: pkg.version,
})
```

Y bumpea `package.json` con `npm version patch` antes de cada release. El README puede mostrar el changelog pero no debería declarar versiones por su cuenta.

## Cómo verificar el fix
```bash
grep -rE "version.*0\\.0\\.[0-9]" package.json src/manifest.ts
# deben mostrar la misma versión
```
""",
    ),
    (
        "[Medio] `data-*` se descarta como ruido, incluyendo `data-testid` que el propio extractor prefiere",
        """## Severidad
🟡 Medio

## Ubicación
- `src/cdp/targetSubtreeNormalization.ts:103` → `DROP_ATTR_PREFIXES = ['data-', 'data-csnap', 'on']`
- `src/core/snap.ts:8-9` → `buildStableSelector` prefiere `data-testid`

## Problema
La normalización del subtree descarta cualquier atributo cuyo nombre empiece con `data-`:

```ts
const DROP_ATTR_PREFIXES = ['data-', 'data-csnap', 'on']
```

Pero el selector estable del propio extractor lo prefiere por encima de todo:

```ts
// snap.ts:8-9
const testId = el.getAttribute('data-testid') || el.getAttribute('data-test')
if (testId) return `[data-testid="${esc(testId)}"]`
```

Resultado: el HTML normalizado pierde el `data-testid`. Si un componente solo tiene `data-testid` como identificador estable, el export queda **sin ancla utilizable**.

Adicionalmente, `'data-csnap'` en el set es redundante — `'data-'` ya lo cubre. Confunde al lector.

## Por qué importa
- Los frameworks de test modernos (Testing Library, Playwright, Cypress) recomiendan `data-testid`. Sitios bien hechos tienen estos atributos. Borrarlos es destruir información crítica.
- El selector exportado en `selectedSelector` puede apuntar a un `data-testid` que ya no existe en el HTML serializado → el `.js` bootstrap del export no encuentra el root.

## Propuesta
Whitelist explícita de los `data-*` que importan, antes del prefix-drop:

```ts
const KEEP_DATA_ATTRS = new Set([
  'data-testid',
  'data-test',
  'data-cy',
  'data-qa',
])

const shouldDropAttribute = (tag, name, ...) => {
  if (KEEP_DATA_ATTRS.has(name)) return false
  // ... resto de la lógica
}
```

Y eliminar `'data-csnap'` del set — está cubierto por `'data-'`.

## Cómo verificar el fix
Test:
```ts
const html = '<div data-testid="user-card" data-internal-state="foo">Hi</div>'
const result = normalizeTargetSubtree({ html, ... })
expect(result.html).toContain('data-testid="user-card"')
expect(result.html).not.toContain('data-internal-state')
```
""",
    ),
    (
        "[Medio] `ALLOWED_ATTRS` tiene duplicados camelCase que solo matchean por accidente en SVG",
        """## Severidad
🟡 Medio

## Ubicación
- `src/portableFallback/extractor.ts:84-100`
- `src/cdp/targetSubtree.ts:42-63`

## Problema
Ambas listas incluyen variantes mayúsculas y minúsculas del mismo atributo:

```ts
const ALLOWED_ATTRS = new Set([
  ...
  'viewbox', 'viewBox',
  'preserveaspectratio', 'preserveAspectRatio',
  'xlink:href',
])
```

En HTML los nombres de atributos están en minúscula tras el parseo del browser. Las variantes camelCase nunca matchean para `HTMLElement.attributes`. Funcionan **a veces** para `SVGElement` porque algunos atributos SVG conservan case en `Element.attributes`.

## Por qué importa
- Señala copy-paste sin entender la regla. Si el revisor next-gen agrega `'preserveCase'` "por si acaso", el set crece sin función.
- El comportamiento real depende del browser y del namespace (HTML vs SVG vs MathML).
- En `targetSubtree.ts` el chequeo es `shouldKeepAttribute(attr.name)` (línea 77, 113) — `attr.name` es lo que el browser parseó, así que la camelCase es ignorada para HTML.

## Propuesta
Normalizar la comparación a lowercase y mantener solo una versión:

```ts
const ALLOWED_ATTRS = new Set([
  'viewbox',
  'preserveaspectratio',
  ...
])

const shouldKeepAttribute = (name: string) =>
  ALLOWED_ATTRS.has(name.toLowerCase()) || ...
```

Documentar en comentario sobre el set: "SVG attributes are compared case-insensitively; browsers normalize HTML attribute names to lowercase but preserve case for SVG."

## Cómo verificar el fix
- `grep -E "viewBox|preserveAspectRatio" src/` → solo en tests o como string literal de output, no en `Set` definitions.
""",
    ),
    (
        "[Medio] Tests omiten los caminos donde el daño realmente ocurre",
        """## Severidad
🟡 Medio

## Ubicación
Múltiples; ver lista abajo.

## Problema
La suite cubre bien:
- `src/portableFallback/extractor.test.ts` → equivalencia del index de pseudo-rules con el legacy.
- `src/cdp/replayViewerState.test.ts` → lógica de viewport del visor.
- `src/cdp/orchestrator.test.ts` → wiring de módulos CDP mockeados.

Pero **no se prueba** ninguno de los caminos donde el código está actualmente roto o frágil:

| Falla real | Test que la detectaría |
|---|---|
| `serializeCssGraph` emite CSS inválido cuando hay keyframes (#1) | Parse del output con `new CSSStyleSheet().replace(css)` y assertar que no hay parse errors |
| `domSnapshot.stats.nodes` cuenta strings, no nodos (#2) | Mock de DOMSnapshot con strings != nodos y assert sobre stats |
| SW reciclado pierde `tabId` y CDP capture se salta (#3) | E2E que dispare `chrome.runtime.reload()` entre `START_INSPECT_TAB` y `ELEMENT_SELECTED` |
| `chrome.storage.local.clear()` borra otros campos (#4) | Set otro campo, dispara save, leer y assert que sigue ahí |
| Alineación `originalNodes`/`clonedNodes` rota tras reorder (#10) | Snapshot test con shadowRoot intercalado |
| `hasScenePositioningStyle` no se dispara porque `style` está stripped (#6) | Test que pase HTML con `style="position:absolute"` y assert `sceneLike === true` |
| Scoring no-monotónico (#12) | Agregar evidence positiva nunca debe bajar el score |

## Por qué importa
Tener suite verde ≠ tener producto correcto. Hoy todos los tests pasan y todos los bugs críticos están en producción al mismo tiempo. La suite testea el _shape_ del wiring, no el _comportamiento_ del producto.

## Propuesta
Agregar la matriz de tests anterior. Idealmente, cada bug crítico (#1-#4) ships con su test de regresión en el mismo PR.

## Cómo verificar el fix
Coverage report: las líneas marcadas como "donde el daño ocurre" deben tener cobertura de comportamiento, no solo de ejecución.
""",
    ),
    # ---------- 🟢 SUGERENCIAS ----------
    (
        "[Sugerencia] `repro_*.ts` en raíz duplican lógica del benchmark harness",
        """## Severidad
🟢 Sugerencia

## Ubicación
- `repro_google.ts` (82 líneas)
- `repro_lichess.ts` (86 líneas)
- `repro_reddit.ts` (81 líneas)
- vs. `scripts/runBenchmark.ts` + `src/benchmark/scenarios.ts`

## Problema
Los tres `repro_*.ts` en raíz son scripts Playwright independientes que abren cada sitio y reproducen un escenario de captura. La lógica de captura ahora vive en el harness (`scripts/runBenchmark.ts`) que ya cubre los mismos tres sitios con definiciones declarativas en `src/benchmark/scenarios.ts`.

## Por qué importa
Cruft. Dos sistemas para el mismo flujo. El que se mantenga acumulará bit rot y eventualmente engañará a alguien que lo corra esperando resultados modernos.

## Propuesta
Una de tres:

1. **Borrar los tres**. Si el benchmark harness los cubre, son cruft.
2. **Documentar su uso específico** en README — si sirven para algo que el harness no hace (debug interactivo con `--headed`, por ejemplo), explícitarlo.
3. **Mover a `scripts/repro/`** y agregarlos como `npm run repro:google` etc., dependiendo del harness compartido.

## Cómo verificar el fix
`ls repro_*.ts` → no devuelve archivos, o README explica para qué sirven.
""",
    ),
    (
        "[Sugerencia] Warning stream sin estructura — >50 strings únicos como prosa libre",
        """## Severidad
🟢 Sugerencia

## Ubicación
Distribuido. Ejemplos:
- `src/cdp/portableExtraction.ts:547-583` (~30 warnings generados ahí)
- `src/cdp/fidelityScoring.ts` (~20 warnings)
- `src/cdp/targetSubtreeNormalization.ts:819-826`
- `src/portableFallback/extractor.ts:392-432`

## Problema
Los warnings son strings libres tipo:

```
'replay-capsule-preservation-reason:class-policy:board-like-prefers-framed-target'
'portable-fallback-shadow-dom-flattened:3'
'fidelity-target-class-reason:class-evidence:scene-primitives-present'
'replay-capsule-target-subtree-preferred-for-frame-integrity'
```

Conté >50 strings únicos repartidos entre módulos. No hay enum, no hay tipo, no hay test que liste los warnings posibles. La UI no puede categorizar (severidad, recoverable vs fatal, dimensión).

## Por qué importa
El epic v2 dice: *"if the system cannot preserve truth, it must preserve evidence"*. La evidencia hoy es **prosa**: imposible de filtrar, agrupar, ordenar o presentar al usuario. El `debug.warnings` del `meta.json` queda como sopa ilegible.

## Propuesta
Definir un enum/union en `types.ts`:

```ts
export type CaptureWarningCode =
  | 'replay-capsule-empty-timeline'
  | 'portable-fallback-shadow-dom-flattened'
  | 'fidelity-target-class-board-like'
  ...

export interface CaptureWarning {
  code: CaptureWarningCode
  severity: 'info' | 'warn' | 'error'
  context?: Record<string, unknown>   // { count: 3 }, { hint: 'board-like' }, etc.
}
```

Y mover todos los `warnings.push('foo:42')` a `warnings.push({ code: 'foo', context: { count: 42 } })`. El visor del popup puede agruparlos; el benchmark puede assertear `expect(warnings).not.toContain({ code: 'replay-capsule-empty-shell-export' })`.

## Cómo verificar el fix
- `grep "warnings.push('" src/` → ~0 hits.
- Un test que enumere todos los códigos vía type-check confirme que ninguno se quedó sin migrar.
""",
    ),
    (
        "[Sugerencia] Phase 0 del epic v2 saltada — `targetClass` shapes mezcladas, dos paths a scoring",
        """## Severidad
🟢 Sugerencia

## Ubicación
- `EPIC_RUNTIME_TWIN_V2.md:284-291` (Phase 0)
- `src/cdp/portableExtraction.ts:7,9-11` (`PortableTargetClass = TargetClass | 'semantic-ui'`)
- `src/cdp/fidelityScoring.ts:13-14` (`targetClass?: TargetClass | 'semantic-ui'`)
- `src/background.ts:441-452` ↔ `src/cdp/orchestrator.ts:130` (dos llamadas a `scoreCaptureFidelity`)

## Problema
El epic v2 lista Phase 0:
- Define export modes (Freeze / Replay / Portable)
- Define `meta.json` v2 schema
- Define fidelity score model
- Define unsupported-feature taxonomy

Estas decisiones nunca se consolidaron en un documento autoritativo. Como consecuencia el código tiene:

1. **`targetClass` con shape ambiguo**: tipos como `TargetClass | 'semantic-ui'` (el `'semantic-ui'` no está en `TargetClass`). Lugares distintos asumen unions distintos.
2. **Dos paths a `scoreCaptureFidelity`**: orquestador lo llama con `{ capture: bundle }`; background lo llama después con `{ capture, portableDiagnostics }`. Producen scores distintos para el mismo capture. El visor muestra uno, el `meta.json` otro.
3. **Diagnostics shapes duplicadas**: `PortableExportDiagnostics` (en portableExtraction) y `FidelityPortableDiagnosticsInput` (en fidelityScoring) tienen campos casi idénticos pero divergen sutilmente.

## Por qué importa
Cada cambio en uno requiere sincronizar los otros, sin herramienta que avise. La superficie crece y la consistencia se erosiona.

## Propuesta
Ejecutar Phase 0 retroactivamente:

1. Un `docs/spec-target-class.md` que defina exactamente los valores de `TargetClass` (¿`'semantic-ui'` es uno? ¿es alias?).
2. Un `docs/spec-meta-json.md` con el schema canónico, generado a tipo TS.
3. Una sola función `scoreCaptureFidelity` con un solo punto de invocación (en el orchestrator); el background no debería recalcular.
4. Una sola interfaz `PortableDiagnosticsV0` reutilizada por todos.

## Cómo verificar el fix
- `grep -rE "'semantic-ui'" src/` solo en el archivo que define el enum.
- `grep "scoreCaptureFidelity(" src/` debería tener una sola llamada productiva.
""",
    ),
    (
        "[Sugerencia] `nodeResolverRuntime.ts` interpola `function.toString()` en una expression CDP",
        """## Severidad
🟢 Sugerencia

## Ubicación
- `src/cdp/nodeResolverRuntime.ts:340`

## Problema
```ts
const confidence = ${scoreToConfidence.toString()}({
  score: best.score,
  scoreDelta,
  penaltyPoints: best.penaltyPoints,
  ambiguousCount,
});
```

Se interpola el `.toString()` de la función TypeScript `scoreToConfidence` dentro del string de expression que `Runtime.evaluate` ejecutará en la página. Funciona hoy porque:

1. El bundler de Vite no minifica el código del background/content por defecto.
2. `scoreToConfidence` no usa imports ni TypeScript-only features (todo es ES plano).

## Por qué importa
Es brittle a cambios de toolchain. Si en algún momento:
- Se habilita minificación (esbuild/terser) → la función se renombra a `e(a,b)=>...` y el string interpolado deja de coincidir con lo que el resto del código asume.
- Se agrega un `import` adentro → fail at runtime con `import is not defined` dentro del eval.
- Se agrega un decorator, types runtime-eval, etc. → roto.

No habrá warning ni en build ni en test — solo el resolver retornando 0 confidence sin razón visible.

## Propuesta
Duplicar la fórmula como string literal explícito:

```ts
const SCORE_TO_CONFIDENCE_BODY = `({ score, scoreDelta, penaltyPoints, ambiguousCount }) => {
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  const base = Math.min(0.97, Math.max(0.18, score / 130))
  const margin = Math.min(0.08, Math.max(0, scoreDelta / 35))
  const drift = Math.min(0.3, Math.max(0, penaltyPoints / 45))
  const ambig = ambiguousCount > 1 ? Math.min(0.22, (ambiguousCount - 1) * 0.07) : 0
  return clamp01(Math.max(0.05, base + margin - drift - ambig))
}`

// y un test cross-checkea que SCORE_TO_CONFIDENCE_BODY evaluado === scoreToConfidence:
test('runtime scoreToConfidence parity', () => {
  const fn = eval(`(${SCORE_TO_CONFIDENCE_BODY})`)
  for (const fixture of fixtures) {
    expect(fn(fixture)).toEqual(scoreToConfidence(fixture))
  }
})
```

Así la duplicación es explícita y un test la mantiene en sync.

## Cómo verificar el fix
- `grep -E "\\$\\{.*\\.toString\\(\\)\\}" src/` → 0 hits.
- Test de paridad pasa.
""",
    ),
]


def post_issue(token: str, title: str, body: str) -> dict:
    payload = json.dumps({"title": title, "body": body}).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "component-snap-issue-creator",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    dry_run = "--dry-run" in sys.argv
    start = 1
    for i, arg in enumerate(sys.argv):
        if arg == "--start" and i + 1 < len(sys.argv):
            start = int(sys.argv[i + 1])

    if not dry_run:
        token = os.environ.get("GITHUB_TOKEN")
        if not token:
            print("ERROR: set GITHUB_TOKEN env var", file=sys.stderr)
            sys.exit(1)
    else:
        token = ""

    for idx, (title, body) in enumerate(ISSUES, start=1):
        if idx < start:
            continue
        print(f"[{idx}/{len(ISSUES)}] {title}")
        if dry_run:
            continue
        try:
            result = post_issue(token, title, body)
            print(f"    created: {result['html_url']}")
            time.sleep(1.2)  # gentle rate-limit
        except urllib.error.HTTPError as e:
            print(f"    HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
            sys.exit(2)
        except Exception as e:
            print(f"    ERROR: {e}", file=sys.stderr)
            sys.exit(3)

    print("done")


if __name__ == "__main__":
    main()
