import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.hoisted(() => vi.fn());
const realReadFileSync = fs.readFileSync;
const realExistsSync = fs.existsSync;

vi.mock('child_process', () => ({
  execSync: execSyncMock,
}));

describe('service-control', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let platformSpy: ReturnType<typeof vi.spyOn>;
  let getUidSpy: ReturnType<typeof vi.spyOn>;
  let readFileSpy: ReturnType<typeof vi.spyOn>;
  let existsSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    execSyncMock.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-bot-service-control-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    platformSpy = vi.spyOn(os, 'platform');
    getUidSpy = vi.spyOn(process, 'getuid');
    readFileSpy = vi.spyOn(fs, 'readFileSync');
    existsSpy = vi.spyOn(fs, 'existsSync');
    writeSpy = vi.spyOn(fs, 'writeFileSync');
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    platformSpy.mockRestore();
    getUidSpy.mockRestore();
    readFileSpy.mockRestore();
    existsSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports launchd, systemd-user, systemd-system and nohup restart modes', async () => {
    const { getRestartRuntimeInfo } = await import('./service-control.js');

    platformSpy.mockReturnValue('darwin');
    expect(getRestartRuntimeInfo()).toMatchObject({
      manager: 'launchd',
      canRestart: true,
    });

    platformSpy.mockReturnValue('linux');
    readFileSpy.mockImplementation((filePath) => {
      if (filePath === '/proc/1/comm') return 'systemd\n';
      return realReadFileSync(filePath, 'utf-8');
    });
    getUidSpy.mockReturnValue(1000);
    expect(getRestartRuntimeInfo()).toMatchObject({
      manager: 'systemd-user',
      canRestart: true,
    });

    getUidSpy.mockReturnValue(0);
    expect(getRestartRuntimeInfo()).toMatchObject({
      manager: 'systemd-system',
      canRestart: true,
    });

    readFileSpy.mockImplementation((filePath) => {
      if (filePath === '/proc/1/comm') throw new Error('no systemd');
      return realReadFileSync(filePath, 'utf-8');
    });
    existsSpy.mockImplementation((filePath) =>
      filePath === path.join(tmpDir, 'start-cnp-bot.sh')
        ? true
        : realExistsSync(filePath),
    );
    expect(getRestartRuntimeInfo()).toMatchObject({
      manager: 'nohup',
      canRestart: true,
    });

    existsSpy.mockReturnValue(false);
    expect(getRestartRuntimeInfo()).toMatchObject({
      manager: 'unsupported',
      canRestart: false,
    });
  });

  it('writes restart status to disk before triggering restart', async () => {
    const { requestServiceRestart, readRestartStatus } = await import('./service-control.js');

    platformSpy.mockReturnValue('linux');
    readFileSpy.mockImplementation((filePath) => {
      if (filePath === '/proc/1/comm') return 'systemd\n';
      return realReadFileSync(filePath, 'utf-8');
    });
    getUidSpy.mockReturnValue(1000);
    execSyncMock.mockReturnValue('');

    requestServiceRestart();

    const statusPath = path.join(tmpDir, 'data', 'system-restart-status.json');
    expect(realExistsSync(statusPath)).toBe(true);
    expect(readRestartStatus()).toMatchObject({ status: 'requested' });
    expect(writeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      execSyncMock.mock.invocationCallOrder[0],
    );
    expect(execSyncMock).toHaveBeenCalledTimes(1);
  });

  it('returns canRestart false when platform is unsupported', async () => {
    const { getRestartRuntimeInfo, requestServiceRestart } = await import('./service-control.js');

    platformSpy.mockReturnValue('win32');

    expect(getRestartRuntimeInfo()).toMatchObject({
      manager: 'unsupported',
      canRestart: false,
    });
    expect(() => requestServiceRestart()).not.toThrow();
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('uses start-cnp-bot.sh for nohup restart mode', async () => {
    const { requestServiceRestart } = await import('./service-control.js');

    platformSpy.mockReturnValue('linux');
    readFileSpy.mockImplementation((filePath) => {
      if (filePath === '/proc/1/comm') throw new Error('no systemd');
      return realReadFileSync(filePath, 'utf-8');
    });
    existsSpy.mockImplementation((filePath) =>
      filePath === path.join(tmpDir, 'start-cnp-bot.sh')
        ? true
        : realExistsSync(filePath),
    );
    execSyncMock.mockReturnValue('');

    requestServiceRestart();

    expect(execSyncMock).toHaveBeenCalledWith(path.join(tmpDir, 'start-cnp-bot.sh'), expect.any(Object));
  });

  it('uses gui/<uid>/com.cnp-bot for launchd restart command', async () => {
    const { requestServiceRestart } = await import('./service-control.js');

    platformSpy.mockReturnValue('darwin');
    getUidSpy.mockReturnValue(501);
    execSyncMock.mockReturnValue('');

    requestServiceRestart();

    expect(execSyncMock).toHaveBeenCalledWith(
      'launchctl kickstart -k gui/501/com.cnp-bot',
      expect.any(Object),
    );
  });

  it('falls back when launchd kickstart fails', async () => {
    const { requestServiceRestart } = await import('./service-control.js');

    platformSpy.mockReturnValue('darwin');
    getUidSpy.mockReturnValue(501);
    execSyncMock
      .mockImplementationOnce(() => {
        throw new Error('kickstart failed');
      })
      .mockReturnValue('');

    requestServiceRestart();

    expect(execSyncMock).toHaveBeenNthCalledWith(
      1,
      'launchctl kickstart -k gui/501/com.cnp-bot',
      expect.any(Object),
    );
    expect(execSyncMock).toHaveBeenNthCalledWith(
      2,
      'launchctl stop com.cnp-bot',
      expect.any(Object),
    );
    expect(execSyncMock).toHaveBeenNthCalledWith(
      3,
      'launchctl start com.cnp-bot',
      expect.any(Object),
    );
  });

  it('marks the restart status healthy after startup completes', async () => {
    const { markRestartStatusHealthy, readRestartStatus } = await import('./service-control.js');

    markRestartStatusHealthy();

    expect(readRestartStatus()).toMatchObject({ status: 'healthy' });
  });
});
