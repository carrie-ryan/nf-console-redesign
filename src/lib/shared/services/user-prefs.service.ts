import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'nf_user_prefs';

export interface RouterColumnVisibility {
  hostSize: boolean;
  ipAddress: boolean;
  domainName: boolean;
  altDomain: boolean;
}

const DEFAULT_ROUTER_COLS: RouterColumnVisibility = { hostSize: false, ipAddress: false, domainName: false, altDomain: false };

@Injectable({ providedIn: 'root' })
export class UserPrefsService {
  private readonly _isPowerUser = signal<boolean>(this.loadPref('isPowerUser', false));
  private readonly _routerColumns = signal<RouterColumnVisibility>(
    this.loadPref('routerColumns', DEFAULT_ROUTER_COLS)
  );

  readonly isPowerUser = this._isPowerUser.asReadonly();
  readonly routerColumns = this._routerColumns.asReadonly();

  togglePowerUser(): void {
    this._isPowerUser.update(v => !v);
    this.savePref('isPowerUser', this._isPowerUser());
  }

  setRouterColumns(cols: RouterColumnVisibility): void {
    this._routerColumns.set(cols);
    this.savePref('routerColumns', cols);
  }

  private loadPref<T>(key: string, defaultValue: T): T {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultValue;
      const prefs = JSON.parse(raw);
      return key in prefs ? prefs[key] : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private savePref(key: string, value: unknown): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const prefs = raw ? JSON.parse(raw) : {};
      prefs[key] = value;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // localStorage unavailable
    }
  }
}
