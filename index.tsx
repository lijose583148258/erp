
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ServerStateProvider } from './app/ServerStateProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { startWebVitalsTelemetry } from './utils/webVitalsTelemetry';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ServerStateProvider>
        <App />
      </ServerStateProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

startWebVitalsTelemetry();
