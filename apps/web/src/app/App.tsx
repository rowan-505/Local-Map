/** Application shell: global providers and client-side routing. */
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/state/AuthContext';
import QueryProvider from './providers/QueryProvider';
import { router } from './router';

export default function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryProvider>
  );
}
