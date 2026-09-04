import { Injectable, signal } from '@angular/core';
import { ServiceTemplate } from '../../features/onboarding/service-templates';

const STORAGE_KEY = 'nf_user_templates';

/**
 * Persistence for USER-saved service templates (Part 4a). Mirrors
 * UserPrefsService exactly: providedIn:'root', a single localStorage key,
 * try/catch-wrapped load/save, and a signal initialized from load and exposed
 * read-only. Unlike the rest of onboarding (in-memory drafts that reset on
 * reload), these survive a page reload — that persistence IS the point of a
 * saved template. Every stored template is `source: 'user'`.
 *
 * NOTE: unlike UserPrefsService's key/value prefs bag, the whole stored value
 * here is the template array — there is no per-key merge.
 */
@Injectable({ providedIn: 'root' })
export class UserTemplatesService {
  private readonly _templates = signal<ServiceTemplate[]>(this.load());

  /** The saved user templates, newest-first is left to the caller. */
  readonly templates = this._templates.asReadonly();

  /** Capture-and-store a new user template. Stamps a fresh id + `source:'user'`
   *  (both forced here, so callers pass only the payload). Returns the stored
   *  template so the caller can confirm what was saved. */
  add(template: Omit<ServiceTemplate, 'id' | 'source'>): ServiceTemplate {
    const stored: ServiceTemplate = {
      ...template,
      id: `user-tmpl-${crypto.randomUUID?.() ?? Date.now()}`,
      source: 'user',
    };
    const next = [...this._templates(), stored];
    this._templates.set(next);
    this.save(next);
    return stored;
  }

  /** Delete a user template by id. */
  remove(id: string): void {
    const next = this._templates().filter((t) => t.id !== id);
    this._templates.set(next);
    this.save(next);
  }

  /** Rename a user template. No-op on an empty name or unknown id. */
  rename(id: string, newName: string): void {
    const name = newName.trim();
    if (!name) return;
    const next = this._templates().map((t) => (t.id === id ? { ...t, name } : t));
    this._templates.set(next);
    this.save(next);
  }

  private load(): ServiceTemplate[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ServiceTemplate[]) : [];
    } catch {
      return [];
    }
  }

  private save(templates: ServiceTemplate[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    } catch {
      // localStorage unavailable
    }
  }
}
