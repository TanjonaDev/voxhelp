import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class LectureTestErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[LectureTest] render crash:", error, info.componentStack);
    this.setState({ info });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-red-50 p-6 font-mono text-sm text-red-900">
          <h1 className="text-lg font-bold mb-2">La page a planté</h1>
          <pre className="whitespace-pre-wrap rounded border border-red-300 bg-white p-3 mb-3">
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          {this.state.info && (
            <pre className="whitespace-pre-wrap rounded border border-red-300 bg-white p-3">
              {this.state.info.componentStack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
