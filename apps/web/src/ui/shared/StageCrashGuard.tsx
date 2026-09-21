import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * A render throw anywhere under here used to take the whole app down to a white screen, which
 * on stage means force-quitting and relaunching mid-show. The guard keeps the rest of the shell
 * — top bar, transport, setlist — alive and offers a retry, so a bad song or a bad chart costs
 * a tap rather than a restart.
 *
 * `resetKey` clears a previous failure: moving to another page or another song is itself the
 * retry, so the guard does not stay stuck on a message once the thing that threw is gone.
 */
export class StageCrashGuard extends Component<
  { children: ReactNode; label?: string; resetKey?: string | number },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || "Something failed to render." };
  }

  componentDidUpdate(previous: { resetKey?: string | number }): void {
    if (this.state.message && previous.resetKey !== this.props.resetKey) {
      this.setState({ message: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Stage crash${this.props.label ? ` (${this.props.label})` : ""}`, error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="stage-crash lyrics-empty meta">
          <p>{this.state.message}</p>
          <button type="button" className="add" onClick={() => this.setState({ message: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
