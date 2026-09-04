import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from '../lib/data-access/auth.interceptor';
// Diagnostic probes DISABLED — they fired live /core + /reporting calls at
// bootstrap and now 401 on the expired staging token. Kept in the tree for
// reference; re-enable the provideAppInitializer entries below to run them.
// import { networkIdProbe } from '../lib/data-access/network-id-probe';
// import { phase1Probe } from '../lib/data-access/phase1-probe';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    // PHASE 0.5 DIAGNOSTIC — disabled (see import note above). Bootstrap must
    // make NO network calls; the token is expired.
    // provideAppInitializer(networkIdProbe),
    // PHASE 1 DIAGNOSTIC — disabled (see import note above).
    // provideAppInitializer(phase1Probe),
  ],
};
