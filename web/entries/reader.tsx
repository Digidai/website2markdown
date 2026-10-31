import { hydrate } from "../client";
import { ErrorPage, LoadingPage, ReaderView } from "../pages/reader";

hydrate({ loading: LoadingPage, reader: ReaderView, error: ErrorPage });
