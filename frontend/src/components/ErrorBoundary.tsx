import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // In production we send to logging without noisy console spew
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="container" style={{ padding: 'var(--space-24) var(--space-4)', textAlign: 'center' }}>
          <span className="label">System Notice</span>
          <h1 style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>Something went wrong</h1>
          <p style={{ margin: '0 auto var(--space-8)', maxWidth: '48ch' }}>
            We encountered an unexpected error while rendering this page. You can try refreshing or returning to the home page.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
            <a href="/" className="btn btn-outline">
              Return Home
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
