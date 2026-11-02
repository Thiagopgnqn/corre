import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AdminErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AdminErrorBoundary caught error]:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto my-12 bg-slate-900 border border-red-500/30 rounded-2xl text-center shadow-xl">
          <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-white mb-2">Error al cargar la pestaña</h2>
          <p className="text-xs text-slate-400 mb-4 font-mono break-words bg-slate-950 p-3 rounded-lg border border-slate-800">
            {this.state.error?.message || 'Ocurrió un error inesperado al procesar los datos.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-lg shadow-indigo-600/20"
          >
            <RotateCcw className="w-4 h-4" />
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
