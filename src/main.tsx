import { createRoot } from 'react-dom/client';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import '@fontsource/press-start-2p/latin-400.css';
import App from './App';
import './styles.css';
import './collection.css';
import './console-themes.css';
import './key-bindings.css';

createRoot(document.getElementById('root')!).render(<App />);
