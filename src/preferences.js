// Presentation-only preference. No game paths, executable paths or session data.
const SIDEBAR_KEY = 'renew.view.sidebar.v1';
export function readSidebarPreference(host) {
  try { return host.localStorage.getItem(SIDEBAR_KEY) !== 'expanded'; }
  catch { return true; }
}
export function writeSidebarPreference(host, collapsed) {
  try { host.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); return true; }
  catch { return false; }
}
