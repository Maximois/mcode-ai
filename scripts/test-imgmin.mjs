// Pruebas del optimizador de imágenes (electron/local-tools/imgmin.js) con un `nativeImage` FALSO e inyectado: validan la
// lógica y las garantías de seguridad (no tocar originales, no pisar, omitir EXIF/APNG, verificar antes de escribir).
// NO prueban la calidad del codificador real de Electron: eso se comprueba una vez en la app. Se corre desde `npm run verify`.
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const M = createRequire(join(root, 'package.json'))(join(root, 'electron', 'local-tools', 'imgmin.js'))
let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.error('  X ' + m) } }
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

// ── nativeImage falso: la "imagen" es el texto FAKEIMG <w>x<h> seguido de relleno ──
const TAG = 'FAKEIMG '
const fakeBuf = (w, h, total) => { const head = Buffer.from(`${TAG}${w}x${h} `); return Buffer.concat([head, Buffer.alloc(Math.max(0, total - head.length), 7)]) }
function makeNI({ corrupt = false, bloat = false, fixedOut = 0 } = {}) {
  const wrap = (w, h) => ({
    isEmpty: () => false,
    getSize: () => ({ width: w, height: h }),
    resize: ({ width, height }) => wrap(width, height),
    toJPEG: (q) => fakeBuf(corrupt ? w + 1 : w, h, bloat ? 10_000_000 : fixedOut || Math.floor(w * h * (q / 100) * 0.12)),
    toPNG: () => fakeBuf(corrupt ? w + 1 : w, h, bloat ? 10_000_000 : Math.floor(w * h * 0.4)),
  })
  return {
    createFromBuffer: (b) => {
      const s = b.toString('latin1'); const i = s.indexOf(TAG)
      const m = i >= 0 && s.slice(i + TAG.length, i + TAG.length + 24).match(/^(\d+)x(\d+) /)
      return m ? wrap(+m[1], +m[2]) : { isEmpty: () => true }
    },
  }
}
// JPEG con o sin EXIF (orientación) y PNG (normal o animado) que además contienen la "imagen" falsa
const jpeg = (w, h, size, ori, be = false) => {
  const parts = [Buffer.from([0xFF, 0xD8])]
  if (ori !== undefined) {
    const t = Buffer.alloc(8 + 2 + 12 + 4)
    t.write(be ? 'MM' : 'II', 0, 'latin1')
    be ? t.writeUInt16BE(42, 2) : t.writeUInt16LE(42, 2)
    be ? t.writeUInt32BE(8, 4) : t.writeUInt32LE(8, 4)
    be ? t.writeUInt16BE(1, 8) : t.writeUInt16LE(1, 8)
    be ? t.writeUInt16BE(0x0112, 10) : t.writeUInt16LE(0x0112, 10)
    be ? t.writeUInt16BE(3, 12) : t.writeUInt16LE(3, 12)
    be ? t.writeUInt32BE(1, 14) : t.writeUInt32LE(1, 14)
    be ? t.writeUInt16BE(ori, 18) : t.writeUInt16LE(ori, 18)
    const seg = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t])
    const hdr = Buffer.from([0xFF, 0xE1, 0, 0]); hdr.writeUInt16BE(seg.length + 2, 2)
    parts.push(hdr, seg)
  } else parts.push(Buffer.from([0xFF, 0xE0, 0x00, 0x04, 0x4A, 0x46]))
  parts.push(fakeBuf(w, h, size))
  return Buffer.concat(parts)
}
const chunk = (type, data = Buffer.alloc(0)) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b }
const png = (w, h, size, animated = false) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', Buffer.alloc(13)), ...(animated ? [chunk('acTL', Buffer.alloc(8))] : []), chunk('IDAT', fakeBuf(w, h, size)), chunk('IEND')])

const tmp = mkdtempSync(join(tmpdir(), 'mcode-img-'))
const proj = (name) => { const d = join(tmp, name); mkdirSync(d, { recursive: true }); return d }
const put = (p, buf) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); return p }
const by = (res, rel) => res.files.find(f => f.rel === rel)

try {
  // ── exifOrientation (unitario) ──
  ok(M.exifOrientation(jpeg(10, 10, 100, 6)) === 6, 'EXIF little-endian: orientación 6')
  ok(M.exifOrientation(jpeg(10, 10, 100, 8, true)) === 8, 'EXIF big-endian: orientación 8')
  ok(M.exifOrientation(jpeg(10, 10, 100, 1)) === 1, 'EXIF orientación 1 (normal)')
  ok(M.exifOrientation(jpeg(10, 10, 100)) === null, 'JPEG sin EXIF: null')
  ok(M.exifOrientation(Buffer.from('no soy jpeg, solo texto largo')) === null, 'no-JPEG: null')
  ok(M.exifOrientation(Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x30, 0x45, 0x78])) === null, 'EXIF truncado: null sin romper')
  ok(M.exifOrientation(Buffer.alloc(0)) === null, 'vacío: null')
  ok(M.isAnimatedPng(png(10, 10, 100, true)) === true && M.isAnimatedPng(png(10, 10, 100)) === false, 'detecta APNG')

  // ── sanitizeOpts ──
  const so = M.sanitizeOpts
  ok(so({ maxWidth: 1600, quality: 70 }).maxWidth === 1600 && so({ maxWidth: 1600, quality: 70 }).quality === 70, 'opciones válidas')
  ok(so({ maxWidth: 999999, quality: 5 }).maxWidth === 2000 && so({ maxWidth: 999999, quality: 5 }).quality === 50, 'ancho inválido -> 2000; calidad mínima 50')
  ok(so({ quality: 500 }).quality === 95 && so({ quality: 'x' }).quality === 80 && so(null).maxWidth === 2000, 'calidad máxima 95, basura -> defecto')
  ok(so({ maxWidth: 0 }).maxWidth === 0, 'maxWidth 0 = no redimensionar')

  // ── flujo principal ──
  const P = proj('main')
  const photo = put(join(P, 'img', 'photo.jpg'), jpeg(4000, 3000, 1_200_000))
  const logo = put(join(P, 'logo.png'), png(1000, 400, 300_000))
  const small = put(join(P, 'tiny.png'), png(10, 10, 2000))
  put(join(P, 'node_modules', 'x', 'big.jpg'), jpeg(4000, 3000, 1_200_000))
  put(join(P, 'other.min.jpg'), jpeg(4000, 3000, 900_000))
  const before = { photo: sha(photo), logo: sha(logo) }
  const ni = makeNI()
  const scan = await M.scanImages(P, {}, ni)
  ok(scan.ok && scan.files.length === 3, `escanea 3 candidatos (sin node_modules ni .min): ${scan.files.map(f => f.rel)}`)
  const ps = by(scan, 'img/photo.jpg')
  ok(ps.status === 'ok' && ps.newWidth === 2000 && ps.newHeight === 1500 && ps.target === 'img/photo.min.jpg' && ps.after < ps.before, 'foto grande: se redimensiona a 2000x1500 y ahorra')
  ok(by(scan, 'logo.png').status === 'ok' && by(scan, 'logo.png').newWidth === 1000, 'PNG chico de ancho: no se agranda ni se redimensiona')
  ok(by(scan, 'tiny.png').status === 'skip', 'imagen de <20 KB se omite')
  ok(!existsSync(join(P, 'img', 'photo.min.jpg')), 'escanear NO escribe nada')
  ok(scan.eligible === 2 && scan.savedBytes > 0, 'resumen del escaneo')
  const app = await M.applyImages(P, {}, ni)
  ok(app.ok && app.written === 2 && app.saved > 0 && app.failedCount === 0, 'aplica 2')
  ok(existsSync(join(P, 'img', 'photo.min.jpg')) && existsSync(join(P, 'logo.min.png')), 'genera foto.min.jpg y logo.min.png junto al original')
  ok(sha(photo) === before.photo && sha(logo) === before.logo, 'los originales quedan IDÉNTICOS (hash)')
  ok(!existsSync(join(P, 'tiny.min.png')) && !existsSync(join(P, 'node_modules', 'x', 'big.min.jpg')), 'no genera para chicas ni dentro de node_modules')
  const app2 = await M.applyImages(P, {}, ni)
  ok(app2.written === 0 && by(app2, 'img/photo.jpg').status === 'exists', 'segunda corrida: idempotente, no pisa lo ya generado')
  const outFile = readFileSync(join(P, 'img', 'photo.min.jpg'))
  ok(ni.createFromBuffer(outFile).getSize().width === 2000, 'el archivo escrito se decodifica con el tamaño esperado')

  // ── maxWidth 0 y calidad ──
  const P2 = proj('nores'); put(join(P2, 'a.jpg'), jpeg(4000, 3000, 1_200_000))
  const r0 = await M.scanImages(P2, { maxWidth: 0, quality: 60 }, makeNI())
  ok(by(r0, 'a.jpg').newWidth === 4000, 'maxWidth 0: conserva el tamaño original')
  const r1 = await M.scanImages(P2, { maxWidth: 1280, quality: 80 }, makeNI())
  ok(by(r1, 'a.jpg').newWidth === 1280 && by(r1, 'a.jpg').after < by(r0, 'a.jpg').after, 'maxWidth 1280 reduce más')

  // ── EXIF / APNG / inválidos ──
  const P3 = proj('skips')
  put(join(P3, 'rot6.jpg'), jpeg(3000, 2000, 900_000, 6))
  put(join(P3, 'rot8be.jpeg'), jpeg(3000, 2000, 900_000, 8, true))
  put(join(P3, 'norm.jpg'), jpeg(3000, 2000, 900_000, 1))
  put(join(P3, 'anim.png'), png(1000, 1000, 400_000, true))
  put(join(P3, 'fake.png'), Buffer.concat([Buffer.from('esto no es un png '), Buffer.alloc(40_000, 1)]))
  put(join(P3, 'broken.jpg'), Buffer.alloc(40_000, 9))
  const s3 = await M.scanImages(P3, {}, makeNI())
  ok(by(s3, 'rot6.jpg').status === 'skip' && /EXIF/.test(by(s3, 'rot6.jpg').reason), 'EXIF rotación 6: omitida')
  ok(by(s3, 'rot8be.jpeg').status === 'skip', 'EXIF big-endian rotación 8: omitida')
  ok(by(s3, 'norm.jpg').status === 'ok', 'EXIF orientación 1: se procesa')
  ok(by(s3, 'anim.png').status === 'skip' && /animado/.test(by(s3, 'anim.png').reason), 'APNG omitido')
  ok(by(s3, 'fake.png').status === 'error', 'PNG falso: error, no se procesa')
  ok(by(s3, 'broken.jpg').status === 'error', 'JPEG ilegible: error')
  await M.applyImages(P3, {}, makeNI())
  ok(readdirSync(P3).filter(f => f.includes('.min.')).join() === 'norm.min.jpg', 'solo se generó el procesable')

  // ── verificación y falta de ahorro ──
  const P4 = proj('verify'); put(join(P4, 'v.jpg'), jpeg(3000, 2000, 900_000))
  const sv = await M.applyImages(P4, {}, makeNI({ corrupt: true }))
  ok(by(sv, 'v.jpg').status === 'error' && /verificaci/.test(by(sv, 'v.jpg').reason) && sv.written === 0 && !existsSync(join(P4, 'v.min.jpg')), 'resultado que no pasa la verificación NO se escribe')
  const sb = await M.applyImages(P4, {}, makeNI({ bloat: true }))
  ok(by(sb, 'v.jpg').status === 'nosavings' && sb.written === 0 && !existsSync(join(P4, 'v.min.jpg')), 'si no ahorra, no se escribe')

  // ── umbrales de ahorro: >= 5% Y >= 1 KB ──
  const P7 = proj('thresholds')
  put(join(P7, 'low-ratio.jpg'), jpeg(1000, 1000, 900_000))   // 900 KB -> 880 KB: ahorra 2,2%
  put(join(P7, 'low-bytes.jpg'), jpeg(1000, 1000, 30_000))    // 30 KB -> 29,5 KB: ahorra menos de 1 KB
  put(join(P7, 'good.jpg'), jpeg(1000, 1000, 900_000))        // 900 KB -> 800 KB: ahorra 11%
  const outs = { 'low-ratio.jpg': 880_000, 'low-bytes.jpg': 29_500, 'good.jpg': 800_000 }
  for (const [name, out] of Object.entries(outs)) {
    const r = await M.scanImages(P7, {}, makeNI({ fixedOut: out }))
    // makeNI aplica el mismo tamaño a todos: se mira solo el archivo que corresponde
    const st = by(r, name).status
    ok(st === (name === 'good.jpg' ? 'ok' : 'nosavings'), `umbral de ahorro: ${name} -> ${st}`)
  }

  // ── no pisar / symlinks / sin entorno ──
  const P5 = proj('safe')
  const orig = put(join(P5, 'a.jpg'), jpeg(3000, 2000, 900_000))
  const foreign = put(join(P5, 'a.min.jpg'), Buffer.from('versión de una librería'))
  const fsha = sha(foreign)
  const s5 = await M.applyImages(P5, {}, makeNI())
  ok(sha(foreign) === fsha && s5.written === 0, 'un .min existente (ajeno) jamás se pisa')
  ok(!s5.files.some(f => f.rel === 'a.min.jpg'), 'los .min no se tratan como candidatos')
  const P6 = proj('links'); const outside = proj('outside')
  put(join(outside, 'secret.jpg'), jpeg(3000, 2000, 900_000))
  let linked = true
  try { symlinkSync(join(outside, 'secret.jpg'), join(P6, 'link.jpg')); symlinkSync(outside, join(P6, 'dirlink')) } catch { linked = false }
  if (linked) {
    const s6 = await M.applyImages(P6, {}, makeNI())
    ok(s6.files.length === 0 && !existsSync(join(outside, 'secret.min.jpg')) && !existsSync(join(P6, 'link.min.jpg')), 'no sigue enlaces simbólicos ni escribe fuera del proyecto')
  }
  const nn = await M.scanImages(P5, {}, null)
  ok(nn.ok === false && /no está disponible/.test(nn.error), 'sin nativeImage devuelve error claro, sin romper')
  ok((await M.scanImages(proj('empty'), {}, makeNI())).files.length === 0, 'carpeta sin imágenes')
  const big = proj('big'); put(join(big, 'huge.jpg'), Buffer.concat([fakeBuf(9000, 9000, 100), Buffer.alloc(26 * 1024 * 1024)]))
  ok(by(await M.scanImages(big, {}, makeNI()), 'huge.jpg').status === 'skip', '>25 MB se omite')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (bad) { console.error(`imágenes: ${bad} de ${n} comprobaciones fallaron`); process.exit(1) }
console.log(`  OK (${n} comprobaciones)`)
