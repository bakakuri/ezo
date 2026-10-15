import { Component } from 'react'
import { reportError } from '../lib/errors.js'

// თეთრი ეკრანის ნაცვლად: რა მოხდა და რა ქნას ადამიანმა. resetKey-ის შეცვლისას (სხვა გვერდზე გადასვლა) თავიდან ცდის.
export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ezo:', error, info?.componentStack)
    const where = (info?.componentStack || '').trim().split('\n').slice(0, 8).map((l) => l.trim()).join('\n')
    reportError(error, 'boundary', where && `კომპონენტები:\n${where}`)
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const message = String(error?.message || error).slice(0, 280)
    return (
      <div className={`crash${this.props.full ? ' full' : ''}`} role="alert">
        <h2>გვერდი ვერ ჩაიტვირთა</h2>
        <p>სცადე თავიდან ჩატვირთვა. თუ ისევ გამოჩნდა, ქვემოთ მოცემული ტექსტი გამოგვიგზავნე.</p>
        <code>{message}</code>
        <div className="crash-actions">
          <button type="button" className="btn btn-accent" onClick={() => window.location.reload()}>თავიდან ჩატვირთვა</button>
          <a className="btn btn-ghost" href="/">მთავარი გვერდი</a>
        </div>
      </div>
    )
  }
}
