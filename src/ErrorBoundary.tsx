import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="fatal"><h1>Une erreur est survenue</h1><p>Rechargez l’application. Vos données restent sur cet appareil.</p><button onClick={() => location.reload()}>Recharger</button></main>;
    return this.props.children;
  }
}
