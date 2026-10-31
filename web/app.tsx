import { LandingPage, type LandingProps } from "./pages/landing";
import { PortalPage } from "./pages/portal";
import { ErrorPage, LoadingPage, ReaderView, type ErrorProps, type LoadingProps, type ReaderProps } from "./pages/reader";

/** What the server embeds in #__props so the client can hydrate the same tree. */
export type AppState =
  | { view: "landing"; props: LandingProps }
  | { view: "portal"; props: { host: string } }
  | { view: "loading"; props: LoadingProps }
  | { view: "reader"; props: ReaderProps }
  | { view: "error"; props: ErrorProps & { host?: string } };

export function App({ state }: { state: AppState }) {
  switch (state.view) {
    case "landing":
      return <LandingPage {...state.props} />;
    case "portal":
      return <PortalPage {...state.props} />;
    case "loading":
      return <LoadingPage {...state.props} />;
    case "reader":
      return <ReaderView {...state.props} />;
    case "error":
      return <ErrorPage {...state.props} />;
  }
}
