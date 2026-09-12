import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import './styles.css';
import App from './App';

const Stats = lazy(() => import('./components/Stats'));
const stats = /^\/stats\/?$/.test(location.pathname);
createRoot(document.getElementById('root')!).render(stats ? <Suspense fallback={<main className="app-loading" role="status">Atveriame istoriją…</main>}><Stats /></Suspense> : <App />);
