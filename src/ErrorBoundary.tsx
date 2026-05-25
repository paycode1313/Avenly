'use client';

import React, { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('❌ Error Boundary caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-zinc-900 to-zinc-950 text-white flex items-center justify-center p-8">
          <div className="max-w-2xl w-full">
            <div className="text-center mb-8">
              <div className="text-6xl mb-4">⚠️</div>
              <h1 className="text-3xl font-black mb-2">App Crashed</h1>
              <p className="text-zinc-400">Maaf, terjadi kesalahan yang tidak terduga</p>
            </div>

            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <p className="text-sm font-bold text-red-400">Error Details</p>
              </div>
              <pre className="text-xs text-red-300 bg-black/30 rounded-xl p-4 overflow-auto max-h-48 font-mono">
                {this.state.error?.toString()}
              </pre>
              {this.state.error?.stack && (
                <>
                  <p className="text-xs text-zinc-500 mt-4 mb-2 uppercase font-bold">Stack Trace:</p>
                  <pre className="text-[10px] text-zinc-600 bg-black/30 rounded-xl p-4 overflow-auto max-h-32 font-mono">
                    {this.state.error.stack}
                  </pre>
                </>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-gradient-to-r from-brand-orange to-red-500 text-white px-6 py-4 rounded-2xl font-black uppercase tracking-wider hover:opacity-90 transition-opacity shadow-xl shadow-brand-orange/30"
              >
                🔄 Reload App
              </button>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                }}
                className="flex-1 bg-white/10 border border-white/20 text-white px-6 py-4 rounded-2xl font-bold hover:bg-white/20 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
