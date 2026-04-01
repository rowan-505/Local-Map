import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import QueryProvider from './app/providers/QueryProvider.tsx'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router/index.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <RouterProvider router={router} />
    </QueryProvider>
  </StrictMode>,
)
