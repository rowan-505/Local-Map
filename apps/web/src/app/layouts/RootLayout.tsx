/** Full-viewport shell for all routes; add shared chrome (nav, toasts) here later. */
import { Outlet } from 'react-router-dom';

export default function RootLayout() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <Outlet />
    </div>
  );
}
