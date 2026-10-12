import type { RouteObject } from 'react-router';
import { Layout } from './Layout';
import { RouteError } from './states';
import { BrowseView, NotFoundView, RootsView, ViewFileView } from './views';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      {
        // Pathless wrapper: errors render inside the layout, so the shell stays usable.
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <RootsView /> },
          { path: '/browse/:root/*', element: <BrowseView /> },
          { path: '/view/:root/*', element: <ViewFileView /> },
          { path: '*', element: <NotFoundView /> },
        ],
      },
    ],
  },
];
