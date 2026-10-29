import { Component, type ReactNode } from "react";
import { ISSUES_URL } from "../lib/links";

/** Shows what went wrong instead of a blank page, with a way out. Your data isn't touched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div className="wrap" role="alert">
        <div className="empty-app">
          <h2>Something went wrong</h2>
          <p className="hint" style={{ fontSize: 14 }}>
            Patchbook hit an error and couldn't show this page. Your patches are still saved on this device. Reload to try again, and if it keeps
            happening, copy the message below into a new issue at{" "}
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">github.com/tripswitch/patchbook-for-reliq/issues</a>.
          </p>
          <textarea className="copyfield" rows={5} readOnly value={`${e.name}: ${e.message}\n${navigator.userAgent}\n${(e.stack ?? "").split("\n").slice(0, 6).join("\n")}`} />
          <div className="row">
            <button type="button" className="btn solid" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
