import { Component, type ErrorInfo, type ReactNode } from "react";
import { useSongStore } from "../../store/songStore";
import { downloadLibraryBackup } from "../../lib/exportImport";
import Button from "./Button";

/**
 * Keeps one broken surface from taking the app with it.
 *
 * Almost every view here is a large SVG/pointer component reading dozens of
 * optional blueprint fields, and there was no boundary anywhere — so one
 * `undefined` in a `.map()` unmounted the shell too, including the transport
 * and the autosave flush. Where this is mounted decides the blast radius:
 * around the routes it is the last line; around `<Outlet />` it protects the
 * spine, so playback and the debounced save keep running while the view
 * offers a retry.
 *
 * `resetKey` re-arms the boundary when navigation changes the thing that
 * failed (a different song, a different tab) — otherwise the first crash
 * would stick for the rest of the session.
 */
export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short name of the region, for the message ("the Drums editor"). */
  label?: string;
  /** Change this to clear the error — e.g. the current route or song id. */
  resetKey?: string;
  /** When false the fallback replaces the whole screen; when true it is a
   *  panel, for a boundary nested inside the shell. */
  embedded?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Swallowed in the UI, but never swallowed in the console: a boundary
    // without the component stack is nearly impossible to act on.
    console.error(`[trackdraft] ${this.props.label ?? "a view"} crashed`, error, info.componentStack);
  }

  /** Re-arm when navigation changes the thing that failed — a different
   *  song or tab should get a fresh attempt, not inherit the crash. */
  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  private downloadBackup = (): void => {
    downloadLibraryBackup(useSongStore.getState().songs);
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const label = this.props.label ?? "This view";
    const body = (
      <div
        role="alert"
        className={`flex flex-col items-start gap-2 border border-danger/50 bg-panel px-4 py-3 text-xs text-ink ${
          this.props.embedded ? "m-3 rounded" : "max-w-lg rounded"
        }`}
      >
        <p className="font-medium text-danger">{label} hit an error and stopped rendering.</p>
        <p className="text-inkMuted">
          Your song is unchanged — every edit up to this point was already saved. Retrying remounts the
          view; if it fails again, the backup below is the whole library as JSON.
        </p>
        <p className="font-mono text-2xs text-inkMuted break-all">{error.message}</p>
        <div className="flex items-center gap-2 pt-0.5">
          <Button variant="primary" size="sm" onClick={this.retry}>
            Try again
          </Button>
          <Button variant="secondary" size="sm" onClick={this.downloadBackup}>
            Download backup
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.location.assign("/")}>
            Back to library
          </Button>
        </div>
      </div>
    );

    if (this.props.embedded) return body;
    return (
      <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-6">{body}</div>
    );
  }
}
