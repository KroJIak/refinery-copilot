import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('root is missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider delayDuration={200}>
        <App />
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>,
);
