import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

// Inicialización temprana de Monaco Editor services.
// Editor.jsx también puede llamar a initVscodeApi() si llegara a ser necesario
// antes de que el editor se monte.
import('./editorServices.js').then(mod => {
  console.log('[main] Editor services module loaded')
  // initVscodeApi será llamada por Editor.jsx bajo demanda
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
