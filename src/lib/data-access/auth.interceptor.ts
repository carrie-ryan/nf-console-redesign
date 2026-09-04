import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment.local';

/**
 * Attaches `Authorization: Bearer <token>` to gateway requests only
 * (/core and /reporting), pulling the token from the gitignored
 * environment.local.ts. No token → header omitted (request still goes out,
 * so a 401 is an obvious, debuggable signal rather than a silent no-op).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isGatewayCall = /(^|\/)(core|reporting)(\/|$)/.test(new URL(req.url, 'http://x').pathname);

  if (isGatewayCall && environment.auth0Token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${environment.auth0Token}` },
    });
  }

  return next(req);
};
