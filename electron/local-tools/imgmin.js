// Optimizador de imágenes local (cero tokens, cero dependencias nativas): usa el `nativeImage` que ya trae Electron.
// Genera `foto.min.jpg` / `logo.min.png` junto a cada original; JAMÁS modifica ni borra el original.
// Seguridad y fidelidad:
//  - Solo .jpg/.jpeg/.png. No sigue enlaces simbólicos. Nunca pisa un .min.* existente (ni ajeno ni propio).
//  - Se omiten las JPEG con rotación EXIF (re-codificar sin tenerla en cuenta las dejaría giradas) y los PNG animados (APNG).
//  - Cada resultado se decodifica de nuevo y se comprueba su tamaño antes de aceptarlo; solo se escribe si ahorra >= 5% y >= 1 KB.
//  - Se procesa de a una imagen, cediendo el turno entre archivos (no congela la app) y con topes de cantidad y de bytes totales.
//  - Todo se RECALCULA al aplicar: no se confía en rutas ni números que vengan de la interfaz.
// `nativeImage` se inyecta (en Electron: require('electron').nativeImage) para poder probar la lógica sin Electron.
const fs = require('fs')
const path = require('path')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', '.vite', 'coverage'])
const EXTS = new Set(['.jpg', '.jpeg', '.png'])
const MIN_BYTES = 20 * 1024            // por debajo de esto no vale la pena
const MAX_BYTES = 25 * 1024 * 1024     // por archivo
const MAX_FILES = 300
const MAX_TOTAL_BYTES = 400 * 1024 * 1024  // por corrida (poca RAM)
const MIN_SAVING_RATIO = 0.05
const MIN_SAVING_BYTES = 1024
const WIDTHS = new Set([0, 1280, 1600, 2000, 2560])

function sanitizeOpts(o) {
  // null/undefined NO son 0: Number(null) === 0 habría desactivado el redimensionado sin que nadie lo pidiera
  const has = (k) => o && typeof o === 'object' && o[k] !== null && o[k] !== undefined && o[k] !== ''
  const w = has('maxWidth') ? Number(o.maxWidth) : NaN
  const q = has('quality') ? Math.round(Number(o.quality)) : NaN
  return {
    maxWidth: WIDTHS.has(w) ? w : 2000,
    quality: Number.isFinite(q) ? Math.min(95, Math.max(50, q)) : 80,
  }
}

// Orientación EXIF de un JPEG (1 = normal). null si no hay EXIF o no se puede leer.
function exifOrientation(buf) {
  try {
    if (buf.length < 12 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null
    let i = 2
    while (i + 4 < buf.length) {
      if (buf[i] !== 0xFF) return null
      const marker = buf[i + 1]
      if (marker === 0xDA || marker === 0xD9) return null // datos de imagen: ya no hay más cabeceras
      const len = buf.readUInt16BE(i + 2)
      if (marker === 0xE1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
        const t = i + 10 // inicio de la cabecera TIFF
        const le = buf.toString('latin1', t, t + 2) === 'II'
        const u16 = (o) => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)
        const u32 = (o) => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)
        let ifd = t + u32(t + 4)
        const count = u16(ifd)
        for (let k = 0; k < count && k < 64; k++) {
          const e = ifd + 2 + k * 12
          if (e + 12 > buf.length) return null
          if (u16(e) === 0x0112) return u16(e + 8)
        }
        return null
      }
      i += 2 + len
    }
  } catch { /* EXIF dañado: se trata como desconocido */ }
  return null
}

// PNG animado: tiene un chunk "acTL" antes de los datos de imagen
function isAnimatedPng(buf) {
  let i = 8
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.toString('latin1', i + 4, i + 8)
    if (type === 'acTL') return true
    if (type === 'IDAT' || type === 'IEND') return false
    i += 12 + len
  }
  return false
}

function walk(root) {
  const out = []
  const stack = [root]
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (out.length >= MAX_FILES) break
      const full = path.join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); continue }
      const ext = path.extname(e.name).toLowerCase()
      if (e.isFile() && EXTS.has(ext) && !e.name.toLowerCase().includes('.min.')) out.push(full)
    }
  }
  return out
}

const yieldTurn = () => new Promise(r => setImmediate(r))

// Calcula (sin escribir) qué pasaría con una imagen. Devuelve el estado y, si corresponde, los bytes nuevos.
function planFile(root, file, opts, ni) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const ext = path.extname(file)
  const targetRel = rel.slice(0, rel.length - ext.length) + '.min' + ext
  const base = { rel, target: targetRel }
  let st
  try { st = fs.lstatSync(file) } catch (e) { return { ...base, status: 'error', reason: e.message, before: 0, after: 0 } }
  if (!st.isFile()) return { ...base, status: 'skip', reason: 'No es un archivo normal', before: 0, after: 0 }
  if (st.size < MIN_BYTES) return { ...base, status: 'skip', reason: 'Ya es chica (<20 KB)', before: st.size, after: st.size }
  if (st.size > MAX_BYTES) return { ...base, status: 'skip', reason: 'Demasiado grande (>25 MB)', before: st.size, after: st.size }
  const targetAbs = path.join(root, targetRel)
  if (fs.existsSync(targetAbs)) return { ...base, status: 'exists', reason: 'Ya existe el .min (no se pisa)', before: st.size, after: st.size }

  let buf
  try { buf = fs.readFileSync(file) } catch (e) { return { ...base, status: 'error', reason: e.message, before: st.size, after: st.size } }
  const isPng = ext.toLowerCase() === '.png'
  if (isPng) {
    if (buf.length < 8 || buf.toString('latin1', 1, 4) !== 'PNG') return { ...base, status: 'error', reason: 'No es un PNG válido', before: st.size, after: st.size }
    if (isAnimatedPng(buf)) return { ...base, status: 'skip', reason: 'PNG animado: se perdería la animación', before: st.size, after: st.size }
  } else {
    const ori = exifOrientation(buf)
    if (ori !== null && ori !== 1) return { ...base, status: 'skip', reason: 'Tiene rotación EXIF: se omite para no girarla mal', before: st.size, after: st.size }
  }

  try {
    let img = ni.createFromBuffer(buf)
    if (!img || img.isEmpty()) return { ...base, status: 'error', reason: 'No se pudo leer la imagen', before: st.size, after: st.size }
    const size = img.getSize()
    let w = size.width, h = size.height
    if (opts.maxWidth && w > opts.maxWidth) {
      const nh = Math.max(1, Math.round(h * opts.maxWidth / w))
      img = img.resize({ width: opts.maxWidth, height: nh, quality: 'best' })
      w = opts.maxWidth; h = nh
    }
    const out = isPng ? img.toPNG() : img.toJPEG(opts.quality)
    if (!out || !out.length) return { ...base, status: 'error', reason: 'No se pudo codificar', before: st.size, after: st.size }
    // Verificación: lo que se va a escribir tiene que decodificarse y tener el tamaño esperado
    const back = ni.createFromBuffer(out)
    const bs = back && !back.isEmpty() ? back.getSize() : null
    if (!bs || bs.width !== w || bs.height !== h) return { ...base, status: 'error', reason: 'El resultado no pasó la verificación', before: st.size, after: st.size }
    const saved = st.size - out.length
    if (saved < MIN_SAVING_BYTES || saved / st.size < MIN_SAVING_RATIO) {
      return { ...base, status: 'nosavings', reason: 'No reduce lo suficiente', before: st.size, after: out.length, width: size.width, height: size.height }
    }
    return { ...base, status: 'ok', before: st.size, after: out.length, width: size.width, height: size.height, newWidth: w, newHeight: h, _out: out, _target: targetAbs }
  } catch (e) {
    return { ...base, status: 'error', reason: e && e.message ? e.message : String(e), before: st.size, after: st.size }
  }
}

async function run(rootIn, optsIn, ni, write) {
  if (!ni || typeof ni.createFromBuffer !== 'function') return { ok: false, error: 'El procesamiento de imágenes no está disponible en este entorno' }
  const root = path.resolve(rootIn)
  const opts = sanitizeOpts(optsIn)
  const files = walk(root)
  const rows = []
  let processed = 0, truncated = files.length >= MAX_FILES, written = 0, saved = 0
  const failed = []
  for (const f of files) {
    let size = 0
    try { size = fs.lstatSync(f).size } catch { /* se informa en planFile */ }
    if (processed + size > MAX_TOTAL_BYTES) { truncated = true; break }
    processed += size
    const p = planFile(root, f, opts, ni)
    if (write && p.status === 'ok') {
      const target = path.resolve(p._target)
      if (!target.startsWith(root + path.sep) || fs.existsSync(target)) failed.push(p.rel)
      else {
        try { fs.writeFileSync(target, p._out, { flag: 'wx' }); written++; saved += p.before - p.after } catch { failed.push(p.rel) }
      }
    }
    const { _out, _target, ...pub } = p
    rows.push(pub)
    await yieldTurn()
  }
  const okRows = rows.filter(r => r.status === 'ok')
  return {
    ok: true, opts, truncated,
    files: rows.sort((a, b) => (b.before - b.after) - (a.before - a.after)),
    eligible: okRows.length,
    savedBytes: okRows.reduce((s, r) => s + (r.before - r.after), 0),
    ...(write ? { written, saved, failedCount: failed.length, failed: failed.slice(0, 10) } : {}),
  }
}

const scanImages = (root, opts, ni) => run(root, opts, ni, false)
const applyImages = (root, opts, ni) => run(root, opts, ni, true)

module.exports = { scanImages, applyImages, sanitizeOpts, exifOrientation, isAnimatedPng, MIN_BYTES }
