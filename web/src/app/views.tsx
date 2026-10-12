import { Link } from 'react-router';
export { BrowseView } from '../browse/BrowseView';
export { RootsView } from '../browse/RootsView';
export { ViewFileView } from '../fileview/ViewFileView';

export function NotFoundView() {
  return (
    <section>
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to roots</Link>
      </p>
    </section>
  );
}
