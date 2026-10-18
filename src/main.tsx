import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { captureSignupSource } from './lib/signupSource';

// Before App's boot effect strips the query string.
captureSignupSource();

createRoot(document.getElementById('root')!).render(<App />);
