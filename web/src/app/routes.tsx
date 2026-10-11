import type { RouteObject } from 'react-router';
import { Layout } from './Layout';
import { BrowseView, NotFoundView, RootsView, ViewFileView } from './views';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <RootsView /> },
      { path: '/browse/:root/*', element: <BrowseView /> },
      { path: '/view/:root/*', element: <ViewFileView /> },
      { path: '*', element: <NotFoundView /> },
    ],
  },
];
