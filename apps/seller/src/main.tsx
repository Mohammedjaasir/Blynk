import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installController } from './lib/installController';
import './styles.css';

// The browser fires its install event once, early: listen before the app has loaded.
installController.start();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
