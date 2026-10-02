import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from '../contexts/AuthContext';
import { OrgProvider } from '../contexts/OrgContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import { ToastProvider } from '../contexts/ToastContext';
import { WorkProvider } from '../contexts/WorkContext';
import { MfaChallengeProvider } from '../contexts/MfaChallengeContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ProviderErrorBoundary } from '../components/ProviderErrorBoundary';
import { NotificationToasts } from '../components/NotificationToasts';
import { queryClient } from './queryClient';

// NOTE: upload state lives in src/contexts/uploadStore.ts (a module
// singleton, no React provider). The UploadProgressDrawer is mounted by
// a gate in src/app/LayoutWrapper.tsx that subscribes to uploads.length
// and only renders the drawer when something is actually uploading —
// until then no upload UI exists in the React tree.

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ErrorBoundary>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>

              {/* Tier 2 (Auth) */}
              <ProviderErrorBoundary tier="auth">
                <AuthProvider>
                  <MfaChallengeProvider>

                    {/* Tier 3 (App Services) */}
                    <ProviderErrorBoundary tier="services">
                      <WebSocketProvider>
                        <OrgProvider>
                          <WorkProvider>
                            <BrowserRouter>
                              <NotificationToasts />
                              {children}
                            </BrowserRouter>
                          </WorkProvider>
                        </OrgProvider>
                      </WebSocketProvider>
                    </ProviderErrorBoundary>

                  </MfaChallengeProvider>
                </AuthProvider>
              </ProviderErrorBoundary>

            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}
