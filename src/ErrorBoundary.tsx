import { Component, type ReactNode } from 'react'

interface ErrorBoundaryState {
  hasError: boolean
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main role="alert" style={{ maxWidth: 520, margin: '15vh auto', padding: 24 }}>
          <h1>Le carnet ne peut pas être affiché</h1>
          <p>Rechargez l’application. Si le problème persiste, exportez ou restaurez une sauvegarde après rétablissement.</p>
        </main>
      )
    }
    return this.props.children
  }
}
