import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort catch for render-time exceptions, so a bug (or a game record a
 * future client version can't process) degrades to this screen instead of an
 * unmounted white page. Recovery is a plain full-page link: reloading re-derives
 * everything from the server's durable record, which is the only state that
 * matters.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-8">
        <div className="text-center flex flex-col items-center gap-6" role="alert">
          <h1 className="text-4xl font-bold">Something went wrong</h1>
          <p className="text-lg text-gray-300 max-w-md">
            The app hit an unexpected error. Your game lives on the server, so reloading is
            safe — it will restore the current position.
          </p>
          <a
            href="/"
            className="py-3 px-6 text-xl font-semibold text-gray-900 bg-white rounded-xl hover:bg-gray-100"
          >
            Back to start
          </a>
        </div>
      </div>
    );
  }
}
