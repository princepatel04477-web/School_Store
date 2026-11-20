// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { isSignedIn, purgeSavedData, readSaved, writeSaved } from './persist';

describe('what the device may remember', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('saves nothing for someone who is not signed in', () => {
    writeSaved('schoolstore_cart', '[1]');
    expect(isSignedIn()).toBe(false);
    expect(localStorage.getItem('schoolstore_cart')).toBeNull();
    expect(readSaved('schoolstore_cart')).toBeNull();
  });

  it('saves and reads for a signed-in parent', () => {
    localStorage.setItem('access', 'token');
    writeSaved('schoolstore_cart', '[1]');
    expect(readSaved('schoolstore_cart')).toBe('[1]');
  });

  it('purge removes every saved choice but keeps the sign-in tokens', () => {
    localStorage.setItem('access', 'a');
    localStorage.setItem('refresh', 'r');
    localStorage.setItem('schoolstore_cart', '[1]');
    localStorage.setItem('schoolstore_lang', 'hi');
    localStorage.setItem('schoolstore_active_selection', '{}');
    sessionStorage.setItem('schoolstore_fit', '{}');
    sessionStorage.setItem('school_store_selection_flow', '{}');
    purgeSavedData();
    expect(localStorage.getItem('schoolstore_cart')).toBeNull();
    expect(localStorage.getItem('schoolstore_lang')).toBeNull();
    expect(localStorage.getItem('schoolstore_active_selection')).toBeNull();
    expect(sessionStorage.getItem('schoolstore_fit')).toBeNull();
    expect(sessionStorage.getItem('school_store_selection_flow')).toBeNull();
    expect(localStorage.getItem('access')).toBe('a');
    expect(localStorage.getItem('refresh')).toBe('r');
  });
});
