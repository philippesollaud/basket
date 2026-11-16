import { Component, type ErrorInfo, type ReactNode } from 'react'
import { errorMessage } from './storage'

interface Props { children: ReactNode }
interface State { error: string | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: errorMessage(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Échec de l’application Basket U11', error, info)
  }

  render() {
    if (this.state.error) {
      return <main className="fatal">
        <h1>Le carnet n’a pas pu être ouvert.</h1>
        <p role="alert">{this.state.error}</p>
        <p>Vérifiez que le stockage du navigateur est autorisé, puis réessayez. Ne videz pas les données du site : cela effacerait votre carnet.</p>
        <button onClick={() => window.location.reload()}>Réessayer</button>
      </main>
    }
    return this.props.children
  }
}
