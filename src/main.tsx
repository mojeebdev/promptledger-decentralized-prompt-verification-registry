import './index.css';
import { createRoot } from 'react-dom/client';
import { Providers } from './providers';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <Providers>
    <App />
  </Providers>
);
