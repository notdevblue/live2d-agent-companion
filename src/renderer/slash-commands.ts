export type ChatCommandId = 'new' | 'settings' | 'stop' | 'status' | 'help';

export const CHAT_COMMANDS: readonly {
  id: ChatCommandId;
  name: string;
  label: string;
  description: string;
}[] = [
  { id: 'new', name: '/new', label: '새 세션', description: '새 대화 세션을 시작합니다.' },
  { id: 'settings', name: '/settings', label: '설정', description: '설정 창을 엽니다.' },
  { id: 'stop', name: '/stop', label: '중단', description: '진행 중인 응답을 중단합니다.' },
  {
    id: 'status',
    name: '/status',
    label: '상태',
    description: '현재 요청 상태를 확인합니다.',
  },
  { id: 'help', name: '/help', label: '도움말', description: '사용 가능한 명령을 확인합니다.' },
];

export type ParsedChatCommand =
  | { type: 'text' }
  | { type: 'command'; command: ChatCommandId }
  | { type: 'unknown' }
  | { type: 'invalid-arguments'; command: ChatCommandId };

export function parseChatCommand(text: string): ParsedChatCommand {
  const value = text.trim();
  if (value === '/') return { type: 'command', command: 'help' };
  const match = /^\/([a-z]+)(?:\s+([\s\S]+))?$/i.exec(value);
  if (!match) return { type: 'text' };
  const command = CHAT_COMMANDS.find(({ id }) => id === match[1]?.toLowerCase());
  if (!command) return { type: match[2] ? 'text' : 'unknown' };
  return { type: match[2] ? 'invalid-arguments' : 'command', command: command.id };
}

let menuSequence = 0;

/** Local composer suggestions; command execution remains the caller's responsibility. */
export class SlashCommandMenu {
  private matches: typeof CHAT_COMMANDS = [];
  private selectedIndex = 0;
  private previousValue = '';
  private dismissedValue: string | undefined;
  private busy = false;

  constructor(
    private readonly textarea: HTMLTextAreaElement,
    private readonly menu: HTMLElement,
    private readonly onExecute: (id: ChatCommandId) => void,
  ) {
    if (!menu.id) menu.id = `slash-command-menu-${++menuSequence}`;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', '채팅 명령');
    textarea.setAttribute('aria-autocomplete', 'list');
    textarea.setAttribute('aria-controls', menu.id);
    textarea.addEventListener('input', () => this.update());
    this.update();
  }

  get selectedCommand(): ChatCommandId | undefined {
    return this.menu.hidden ? undefined : this.matches[this.selectedIndex]?.id;
  }

  update(): void {
    const value = this.textarea.value;
    if (value !== this.previousValue) {
      this.selectedIndex = 0;
      this.dismissedValue = undefined;
    }
    this.previousValue = value;
    this.matches =
      /^\/[a-z]*$/i.test(value) && value !== this.dismissedValue
        ? CHAT_COMMANDS.filter(({ name }) => name.startsWith(value.toLowerCase()))
        : [];
    this.render();
  }

  close(): void {
    this.dismissedValue = this.textarea.value;
    this.matches = [];
    this.render();
  }

  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    this.render();
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (event.isComposing || event.keyCode === 229 || (event.key === 'Enter' && event.shiftKey))
      return false;
    this.update();
    if (!this.selectedCommand) return false;
    switch (event.key) {
      case 'ArrowDown':
        this.selectedIndex = (this.selectedIndex + 1) % this.matches.length;
        break;
      case 'ArrowUp':
        this.selectedIndex = (this.selectedIndex + this.matches.length - 1) % this.matches.length;
        break;
      case 'Home':
        this.selectedIndex = 0;
        break;
      case 'End':
        this.selectedIndex = this.matches.length - 1;
        break;
      case 'Escape':
        this.close();
        break;
      case 'Tab': {
        if (this.busy) break;
        const command = this.matches[this.selectedIndex];
        if (command) {
          this.textarea.value = command.name;
          this.textarea.setSelectionRange(command.name.length, command.name.length);
          this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        break;
      }
      case 'Enter':
        if (!event.repeat) this.executeSelected();
        break;
      default:
        return false;
    }
    event.preventDefault();
    this.render();
    return true;
  }

  private executeSelected(): void {
    const command = this.selectedCommand;
    if (this.busy || !command) return;
    this.close();
    this.onExecute(command);
  }

  private render(): void {
    this.menu.replaceChildren();
    this.menu.hidden = this.matches.length === 0;
    this.textarea.setAttribute('aria-expanded', String(!this.menu.hidden));
    this.textarea.removeAttribute('aria-activedescendant');
    for (const [index, command] of this.matches.entries()) {
      const button = this.menu.ownerDocument.createElement('button');
      button.type = 'button';
      button.id = `${this.menu.id}-${command.id}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === this.selectedIndex));
      button.setAttribute('aria-label', `${command.name} ${command.label}`);
      button.tabIndex = -1;
      button.disabled = this.busy;
      const name = this.menu.ownerDocument.createElement('code');
      name.textContent = command.name;
      const label = this.menu.ownerDocument.createElement('span');
      label.textContent = command.label;
      button.title = command.description;
      button.append(name, label);
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        if (this.menu.hidden || this.busy) return;
        this.selectedIndex = index;
        this.executeSelected();
      });
      if (index === this.selectedIndex)
        this.textarea.setAttribute('aria-activedescendant', button.id);
      this.menu.append(button);
    }
  }
}
