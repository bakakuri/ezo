import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import './styles/global.css'
import './styles/games.css'
import './styles/digital.css'
import { registerServiceWorker } from './lib/push.js'
import { installErrorReporter } from './lib/errors.js'
import './lib/install.js' // „დააყენე ეზო“ — მოვლენა ადრე მოდის, ადრევე ვუსმენთ

installErrorReporter()
registerServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary full>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
