// Pruebas del mapa del proyecto (src/projectMap.js)
import { buildProjectMap, renderMapForAI, scoreFiles } from '../src/projectMap.js'
let bad = 0
const ok = (c, m) => { if (!c) { bad++; console.error('  X ' + m) } }
const files = {
  'src/App.jsx': "// App.jsx — pantalla principal de la aplicación\nimport React from 'react'\nimport { useTabs } from './hooks/useTabs'\nimport TabBar from './TabBar.jsx'\nexport default function App() {\n  return <TabBar />\n}\n",
  'src/TabBar.jsx': "import React from 'react'\nexport const TabBar = () => <div/>\n",
  'src/hooks/useTabs.js': "export function useTabs() { return [] }\nexport const useThing = () => 1\n",
  'src/util.js': "export const MAX_X = 3\nfunction helper() {}\n  function nested() {}\n",
  'electron/main.js': "const { ipcMain } = require('electron')\nipcMain.handle('fs-read', () => 1)\n",
  'src/styles.css': 'body{}',
  'README.md': '# Mi app\n',
  'big.js': '[archivo muy grande, omitido]',
}
const m = buildProjectMap(files)
ok(m.files['src/App.jsx'].role === 'ui', 'App.jsx es ui')
ok(m.files['src/hooks/useTabs.js'].role === 'hooks', 'useTabs es hooks')
ok(m.files['electron/main.js'].role === 'main', 'main.js es main')
ok(m.files['src/styles.css'].role === 'styles' && m.files['README.md'].role === 'docs', 'estilos/docs')
ok(m.files['src/App.jsx'].symbols[0]?.name === 'App' && m.files['src/App.jsx'].symbols[0].kind === 'component', 'símbolo App componente')
ok(m.files['src/TabBar.jsx'].symbols[0]?.kind === 'component', 'arrow component')
ok(m.files['src/hooks/useTabs.js'].symbols.some(s => s.name === 'useThing' && s.kind === 'hook'), 'hook arrow')
ok(!m.files['src/util.js'].symbols.some(s => s.name === 'nested'), 'no incluye funciones anidadas')
ok(m.files['src/util.js'].symbols.find(s => s.name === 'MAX_X')?.line === 1, 'línea correcta')
ok(m.files['electron/main.js'].ipc[0]?.name === 'fs-read', 'ipc detectado')
ok(m.files['src/App.jsx'].imports.includes('src/TabBar.jsx') && m.files['src/TabBar.jsx'].usedBy.includes('src/App.jsx'), 'grafo de imports')
ok(m.files['src/App.jsx'].summary === 'pantalla principal de la aplicación', 'resumen')
ok(m.files['big.js'].omitted, 'omitido marcado')
const txt = renderMapForAI(m, { maxTokens: 2000 })
ok(txt.includes('MAPA DEL PROYECTO') && txt.includes('App:5'), 'render incluye símbolo:línea')
ok(renderMapForAI(m, { maxTokens: 60 }).length > 0, 'render con presupuesto mínimo no revienta')
ok(scoreFiles(m, files, 'la barra de pestañas no cierra', 'src/App.jsx')[0]?.rel === 'src/TabBar.jsx' || scoreFiles(m, files, 'arreglá las pestañas tabs', 'src/App.jsx').length > 0, 'relevancia en español')
ok(buildProjectMap(files) === m, 'memoizado')
if (bad) { console.error(bad + ' fallo(s)'); process.exit(1) }
console.log('  OK (mapa del proyecto)')
