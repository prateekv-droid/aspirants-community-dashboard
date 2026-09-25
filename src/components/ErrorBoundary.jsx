import { Component } from 'react'

/* A render error in one view should not white-screen the whole tool — the
   imported data is still in IndexedDB and the other views still work. */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) { console.error('View crashed:', error, info) }

  componentDidUpdate(prev) {
    // clear the error when the user navigates somewhere else
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="glass empty">
        <span className="big-ico" aria-hidden>⚠</span>
        <h2>This view hit an error</h2>
        <p className="sub">
          Your imported data is safe — it lives in this browser, not in the page. Try another section, or a
          different date range.
        </p>
        <code style={{ fontSize: 11.5, color: 'var(--text-3)', maxWidth: '60ch', wordBreak: 'break-word' }}>
          {String(this.state.error?.message || this.state.error)}
        </code>
        <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
