export interface ModalOptions {
  danger?: boolean;
  [key: string]: unknown;
}

export interface Modal {
  _show(opts: Record<string, unknown>): void;
  alert(body: string, opts?: ModalOptions): Promise<void>;
  confirm(body: string, opts?: ModalOptions): Promise<boolean>;
  prompt(body: string, defaultValue?: string, opts?: ModalOptions): Promise<string | null>;
}

export const modal: Modal;
