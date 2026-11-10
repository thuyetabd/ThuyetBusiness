const STARTUP_NAME = 'Thuyet.BusinessDesk';

// Electron must receive identical path/args when reading and writing this entry.
function createStartupController(app, executablePath) {
  const options = {path: executablePath, args: ['--hidden']};
  function read() {
    const result = app.getLoginItemSettings(options);
    return result.openAtLogin === true && result.executableWillLaunchAtLogin !== false;
  }
  function set(enabled) {
    app.setLoginItemSettings({...options, name: STARTUP_NAME, openAtLogin: enabled, enabled});
    const actual = read();
    if (actual !== enabled) throw new Error('Windows chưa lưu được thiết lập khởi động.');
    return actual;
  }
  return {read, set};
}

module.exports = {createStartupController};
