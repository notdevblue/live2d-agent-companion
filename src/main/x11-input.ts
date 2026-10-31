import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { OverlayInputRegion } from '../shared/contracts.js';

// One fixed own-window target for the entire child lifetime. Renderer input can
// supply bounded rectangles, never a process, window ID, command or executable.
export class X11InputShape {
  private readonly child: ChildProcessWithoutNullStreams;
  private pending: OverlayInputRegion | undefined;
  private busy = false;
  private closed = false;
  private initialized = false;
  private responseTimeout: ReturnType<typeof setTimeout> | undefined;
  private fail: () => void = () => {};
  private readonly ready: Promise<void>;

  private constructor(binary: string, windowId: number, onFailure: () => void) {
    this.child = spawn(binary, [String(windowId), String(process.pid)], { stdio: 'pipe' });
    this.child.stderr.resume();
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => fail(), 2000);
      let buffer = '';
      const fail = (): void => {
        if (this.closed) return;
        this.closed = true;
        this.pending = undefined;
        clearTimeout(timeout);
        clearTimeout(this.responseTimeout);
        this.child.stdin.end();
        const shutdown = setTimeout(() => this.child.kill(), 500);
        shutdown.unref();
        this.child.once('exit', () => clearTimeout(shutdown));
        if (this.initialized) onFailure();
        else reject(new Error('X11 input shape helper unavailable'));
      };
      this.fail = fail;
      this.child.on('error', fail);
      this.child.on('exit', fail);
      this.child.stdin.on('error', fail);
      this.child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 256) return fail();
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) break;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line === 'ready' && !this.initialized) {
            this.initialized = true;
            clearTimeout(timeout);
            resolve();
          } else if (line === 'ok' && this.initialized && this.busy) {
            clearTimeout(this.responseTimeout);
            this.busy = false;
            this.sendNext();
          } else return fail();
        }
      });
    });
  }

  static async open(
    binary: string,
    windowId: number,
    onFailure: () => void,
  ): Promise<X11InputShape> {
    const helper = new X11InputShape(binary, windowId, onFailure);
    await helper.ready;
    if (helper.closed) throw new Error('X11 input shape helper unavailable');
    return helper;
  }

  update(region: OverlayInputRegion): void {
    if (this.closed) return;
    this.pending = region; // Coalesce frames instead of queueing old silhouettes.
    this.sendNext();
  }

  private sendNext(): void {
    if (this.closed || !this.initialized || this.busy || !this.pending) return;
    const region = this.pending;
    this.pending = undefined;
    this.busy = true;
    this.responseTimeout = setTimeout(() => this.fail(), 2000);
    this.child.stdin.write(
      `${region.width} ${region.height} ${region.rects.length}\n` +
        region.rects.map((rect) => `${rect.x} ${rect.y} ${rect.width} ${rect.height}\n`).join(''),
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.responseTimeout);
    this.pending = undefined;
    this.child.stdin.end();
    const timeout = setTimeout(() => this.child.kill(), 500);
    timeout.unref();
    this.child.once('exit', () => clearTimeout(timeout));
  }
}
