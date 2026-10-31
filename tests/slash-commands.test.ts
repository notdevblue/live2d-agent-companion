// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_COMMANDS,
  parseChatCommand,
  SlashCommandMenu,
} from '../src/renderer/slash-commands.js';

function setup(value = '/') {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  const menu = document.createElement('div');
  const execute = vi.fn();
  document.body.replaceChildren(textarea, menu);
  const commands = new SlashCommandMenu(textarea, menu, execute);
  const input = (text: string) => {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...options });
    return { handled: commands.handleKeydown(event), event };
  };
  return { textarea, menu, execute, commands, input, key };
}

describe('FR-UI-002 local slash command parsing', () => {
  it('recognizes exact commands without accepting arguments', () => {
    for (const { id, name } of CHAT_COMMANDS) {
      expect(parseChatCommand(`  ${name.toUpperCase()}  `)).toEqual({
        type: 'command',
        command: id,
      });
      expect(parseChatCommand(`${name} argument`)).toEqual({
        type: 'invalid-arguments',
        command: id,
      });
    }
    expect(parseChatCommand('/')).toEqual({ type: 'command', command: 'help' });
    expect(parseChatCommand('/unknown')).toEqual({ type: 'unknown' });
  });

  it('preserves absolute paths and ordinary slash-prefixed text', () => {
    for (const text of [
      '/etc/os-release',
      '/new/file',
      '/tmp/a file',
      '/알려줘 이 파일',
      '/ordinary multiword text',
      '/hello\nworld',
      '일반 메시지 /new',
      '',
    ])
      expect(parseChatCommand(text)).toEqual({ type: 'text' });
  });
});

describe('FR-UI-002 slash command menu', () => {
  it('filters suggestions and provides accessible selection without rendering input HTML', () => {
    const { menu, textarea, commands, input } = setup();
    expect(menu.hidden).toBe(false);
    expect(menu.querySelectorAll('button')).toHaveLength(CHAT_COMMANDS.length);
    expect(commands.selectedCommand).toBe('new');
    expect(textarea.getAttribute('aria-controls')).toBe(menu.id);
    expect(textarea.getAttribute('aria-expanded')).toBe('true');
    expect(textarea.getAttribute('aria-activedescendant')).toBe(`${menu.id}-new`);
    expect(menu.querySelector('[aria-selected="true"]')?.textContent).toContain('/new');
    input('/S');
    expect(menu.querySelectorAll('button')).toHaveLength(3);
    expect(commands.selectedCommand).toBe('settings');
    input('/<img src=x onerror=alert(1)>');
    expect(menu.hidden).toBe(true);
    expect(menu.querySelector('img')).toBeNull();
    expect(textarea.getAttribute('aria-expanded')).toBe('false');
    expect(textarea.hasAttribute('aria-activedescendant')).toBe(false);
    for (const value of ['/etc/os-release', '/no-match', '/new more', 'hello']) {
      input(value);
      expect(menu.hidden).toBe(true);
      expect(commands.selectedCommand).toBeUndefined();
    }
  });

  it('navigates with wrapping arrows and Home/End, then executes once', () => {
    const { commands, key, execute, menu } = setup();
    expect(key('ArrowUp').event.defaultPrevented).toBe(true);
    expect(commands.selectedCommand).toBe('help');
    key('ArrowDown');
    expect(commands.selectedCommand).toBe('new');
    key('End');
    expect(commands.selectedCommand).toBe('help');
    key('Home');
    key('ArrowDown');
    expect(commands.selectedCommand).toBe('settings');
    expect(key('Enter', { repeat: true }).handled).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(key('Enter').handled).toBe(true);
    expect(execute).toHaveBeenCalledExactlyOnceWith('settings');
    expect(menu.hidden).toBe(true);
    key('Enter', { repeat: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('completes with Tab without executing and lets IME and Shift+Enter pass through', () => {
    const { textarea, commands, execute, key } = setup('/s');
    const onInput = vi.fn();
    textarea.addEventListener('input', onInput);
    key('ArrowDown');
    expect(commands.selectedCommand).toBe('stop');
    expect(key('Tab').event.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('/stop');
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
      const result = key('Enter', options);
      expect(result.handled).toBe(false);
      expect(result.event.defaultPrevented).toBe(false);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps Escape dismissal until the input changes', () => {
    const { commands, menu, input, key } = setup('/s');
    expect(key('Escape').handled).toBe(true);
    commands.update();
    commands.setBusy(false);
    expect(menu.hidden).toBe(true);
    expect(key('ArrowDown').handled).toBe(false);
    input('/st');
    expect(menu.hidden).toBe(false);
    commands.close();
    input('/st');
    expect(menu.hidden).toBe(true);
    input('/sta');
    expect(commands.selectedCommand).toBe('status');
  });

  it('preserves focus on mouse down and safely executes a clicked command only once', () => {
    const { textarea, menu, execute } = setup();
    textarea.focus();
    const button = menu.querySelectorAll('button')[2]!;
    const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(textarea);
    button.click();
    button.click();
    expect(execute).toHaveBeenCalledExactlyOnceWith('stop');
  });

  it('disables mouse and keyboard execution while busy and restores it after completion', () => {
    const { commands, menu, execute, key, textarea } = setup('/n');
    commands.setBusy(true);
    expect([...menu.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    menu.querySelector('button')?.click();
    key('Enter');
    key('Tab');
    expect(textarea.value).toBe('/n');
    expect(execute).not.toHaveBeenCalled();
    commands.setBusy(false);
    expect(menu.querySelector('button')?.disabled).toBe(false);
    key('Enter');
    expect(execute).toHaveBeenCalledExactlyOnceWith('new');
  });
});
