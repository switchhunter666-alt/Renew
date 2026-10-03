import {DEFAULT_POWER_PREFERENCES, writePowerPreferences, resetPowerPreferences, renderPaletteResults, renderDeviceInfo} from './power.js';
import {icon} from './visuals.js';

// Dialog-only presentation and listeners. No library state or launch capability.
export function powerSettingsMarkup(preferences) {
  return `      <section id="settings-panel-power" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-power" hidden>
        <div class="settings-section-title"><div><h3>A few extra tools</h3><p>Optional shortcuts and read-only runtime information. Everything starts off.</p></div></div>
        <label class="setting-row"><span><strong>Power user tools</strong><small id="power-description">Turn these extras on for this Renew profile</small></span><input type="checkbox" id="power-enabled" role="switch" aria-label="Power user tools" aria-describedby="power-description" ${preferences.enabled ? 'checked' : ''}></label>
        <label class="setting-row"><span><strong>Command palette</strong><small id="palette-description">Commands button and Ctrl+K. Search existing actions and games.</small></span><input type="checkbox" id="power-palette" role="switch" aria-label="Command palette" aria-describedby="palette-description" ${preferences.commandPalette ? 'checked' : ''}></label>
        <p class="field-hint" id="power-status">${preferences.enabled ? 'Extras are on. These preferences are separate from your game library.' : 'Extras are off. Your command-palette choice is remembered but inactive.'}</p>
        <section class="device-section" aria-labelledby="device-title"><h3 id="device-title">This device</h3><p class="field-hint">Read runtime facts only. Hardware is not identified. Hardware integrations are not included in this build.</p><button class="button subtle" id="read-device">Read device information</button><div id="device-info" aria-live="polite"><p class="field-hint">No information has been read.</p></div></section>
        <div class="power-reset"><button class="text-button" id="reset-power">Reset Power user tools</button><p class="field-hint">Turns both switches off. Your library, emulator settings and menu choice stay as they are.</p></div>
      </section>
`;
}

export function bindPowerSettings({dialog, host, getDeviceInfo, isPreview, getPreferences, setPreferences, isBusy, getCategory, isCurrent, changed, notify, announce}) {
  let deviceRequest = 0, devicePending = false;
  const clearDevice = () => { deviceRequest++; devicePending = false; dialog.querySelector('#device-info').innerHTML = '<p class="field-hint">No information has been read.</p>'; };
  const sync = () => {
    dialog.querySelector('#power-enabled').checked = getPreferences().enabled;
    const palette = dialog.querySelector('#power-palette');
    palette.checked = getPreferences().commandPalette;
    palette.disabled = isBusy() || !getPreferences().enabled;
    dialog.querySelector('#read-device').disabled = isBusy() || !getPreferences().enabled || devicePending;
    dialog.querySelector('#power-status').textContent = getPreferences().enabled ? 'Extras are on. These preferences are separate from your game library.' : 'Extras are off. Your command-palette choice is remembered but inactive.';
  };
  const savePower = () => {
    if (!writePowerPreferences(host, getPreferences())) notify('Power user preferences changed for this session. This profile could not save them.');
    changed();
  };
  dialog.querySelector('#power-enabled').addEventListener('change', event => { setPreferences({...getPreferences(), enabled: event.target.checked}); if (!getPreferences().enabled) clearDevice(); savePower(); });
  dialog.querySelector('#power-palette').addEventListener('change', event => { if (!getPreferences().enabled) return; setPreferences({...getPreferences(), commandPalette: event.target.checked}); savePower(); });
  dialog.querySelector('#reset-power').addEventListener('click', () => {
    setPreferences({...DEFAULT_POWER_PREFERENCES}); clearDevice();
    if (!resetPowerPreferences(host)) notify('Power user tools reset for this session. The saved preference could not be cleared.');
    changed(); announce('Power user tools reset. Both switches are off.');
  });
  const readDeviceInfo = async () => {
    if (!getPreferences().enabled || devicePending || isBusy() || getCategory() !== 'power') return;
    const request = ++deviceRequest; devicePending = true; sync();
    const target = dialog.querySelector('#device-info');
    target.innerHTML = '<p class="field-hint" role="status">Reading runtime information…</p>';
    try {
      if (isPreview) { target.innerHTML = '<p class="notice" role="status">Unavailable in the visual preview. Runtime and hardware facts are not simulated here.</p>'; return; }
      if (typeof getDeviceInfo !== 'function') throw new Error('Unavailable');
      const snapshot = await getDeviceInfo();
      if (isCurrent() && request === deviceRequest && dialog.open && getPreferences().enabled) target.innerHTML = renderDeviceInfo(snapshot);
    } catch {
      if (isCurrent() && request === deviceRequest && dialog.open) target.innerHTML = '<p class="notice warning" role="alert">Device information is unavailable. Try reading it again.</p>';
    } finally {
      if (isCurrent() && request === deviceRequest && dialog.open) { devicePending = false; sync(); }
    }
  };
  dialog.querySelector('#read-device').addEventListener('click', readDeviceInfo);
  sync();
  return {sync, clear: clearDevice, read: readDeviceInfo};
}

export function bindCommandPalette({dialog, showDialog, closeDialog, getCommands, activate}) {
  showDialog(`<div class="dialog-top"><div><div class="eyebrow">POWER USER TOOLS</div><h2 id="dialog-title">Commands</h2></div><button class="icon-button" data-close aria-label="Close commands">${icon('close')}</button></div><label class="field-label" for="palette-search">Find a command or game</label><input class="text-input" id="palette-search" type="search" maxlength="160" autocomplete="off" placeholder="Try Library, unplayed, or a game title"><p class="field-hint">Up to 12 matches. Type to narrow them. Arrow keys browse; Enter activates; Escape closes.</p><div id="palette-results"></div>`, 'command-palette');
  const search = dialog.querySelector('#palette-search');
  const results = dialog.querySelector('#palette-results');
  const refresh = () => {
    const focused = dialog.contains(document.activeElement) ? document.activeElement.dataset.powerCommand : null;
    results.innerHTML = renderPaletteResults(getCommands(search.value));
    if (focused) (results.querySelector(`[data-power-command="${CSS.escape(focused)}"]:not(:disabled)`) || search).focus();
  };
  search.addEventListener('input', refresh);
  results.addEventListener('click', event => { const button = event.target.closest('[data-power-command]'); if (button && !button.disabled) activate(button.dataset.powerCommand); });
  dialog.onkeydown = event => {
    // Native search inputs consume Escape to clear text before dialog cancellation.
    if (event.key === 'Escape' && !event.isComposing && !event.repeat) { event.preventDefault(); event.stopPropagation(); closeDialog(); return; }
    // Consume Enter before the dialog closes so it cannot reach body-level launch.
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const command = event.target.closest('[data-power-command]') || (event.target === search && results.querySelector('[data-power-command]:not(:disabled)'));
      if (command) activate(command.dataset.powerCommand);
      else if (event.target.closest('[data-close]')) closeDialog();
      return;
    }
    if (event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const buttons = [...results.querySelectorAll('[data-power-command]:not(:disabled)')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      buttons[index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    } else if (index >= 0 && ['Home', 'End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : buttons.length - 1].focus(); }
  };
  refresh(); search.focus();
  return {refresh, query: () => search.value};
}
