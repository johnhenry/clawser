import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const PERIPHERAL_TYPES: Readonly<{ SERIAL: 'serial'; BLUETOOTH: 'bluetooth'; USB: 'usb' }>;

export function resetHandleCounter(): void;

export class PeripheralHandle {
  constructor(type: string, opts?: Record<string, unknown>);
  get id(): string;
  get type(): string;
  get connected(): boolean;
  get name(): string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(data: string | Uint8Array): Promise<void>;
  read(): Promise<string>;
  info(): Record<string, unknown>;
}

export class SerialPeripheral extends PeripheralHandle {
  constructor(opts?: { baudRate?: number; port?: unknown; requestPortFn?: () => Promise<unknown> });
}

export class BluetoothPeripheral extends PeripheralHandle {
  constructor(opts?: { serviceUuid?: string; requestDeviceFn?: () => Promise<unknown> });
  subscribe(serviceUUID: string, charUUID: string): Promise<void>;
  unsubscribe(serviceUUID: string, charUUID: string): Promise<void>;
}

export class USBPeripheral extends PeripheralHandle {
  constructor(opts?: { requestDeviceFn?: () => Promise<unknown> });
}

export class PeripheralManager {
  constructor(opts?: { onLog?: (msg: string) => void; requestSerialPortFn?: () => Promise<unknown>; requestBluetoothDeviceFn?: () => Promise<unknown>; requestUSBDeviceFn?: () => Promise<unknown> });
  get count(): number;
  connect(type: string, opts?: Record<string, unknown>): Promise<PeripheralHandle>;
  disconnect(id: string): Promise<void>;
  send(id: string, data: string | Uint8Array): Promise<void>;
  read(id: string): Promise<string>;
  get(id: string): PeripheralHandle | undefined;
  list(): Array<{ id: string; type: string; name: string; connected: boolean }>;
  requestSerial(opts?: Record<string, unknown>): Promise<PeripheralHandle>;
  requestBluetooth(filters?: Array<Record<string, unknown>>): Promise<PeripheralHandle>;
  requestUSB(filters?: Array<Record<string, unknown>>): Promise<PeripheralHandle>;
  reconnectSerial(): Promise<PeripheralHandle[]>;
  reconnectUSB(): Promise<PeripheralHandle[]>;
  reconnectBluetooth(): Promise<PeripheralHandle[]>;
  disconnectAll(): Promise<void>;
}

export class HwListTool extends BrowserTool {
  constructor(manager: PeripheralManager);
  execute(): Promise<ToolResult>;
}

export class HwConnectTool extends BrowserTool {
  constructor(manager: PeripheralManager);
  execute(params: { type: string; baud_rate?: number; service_uuid?: string }): Promise<ToolResult>;
}

export class HwSendTool extends BrowserTool {
  constructor(manager: PeripheralManager);
  execute(params: { id: string; data: string }): Promise<ToolResult>;
}

export class HwReadTool extends BrowserTool {
  constructor(manager: PeripheralManager);
  execute(params: { id: string }): Promise<ToolResult>;
}

export class HwDisconnectTool extends BrowserTool {
  constructor(manager: PeripheralManager);
  execute(params: { id: string }): Promise<ToolResult>;
}

export class HwInfoTool extends BrowserTool {
  constructor(manager: PeripheralManager);
  execute(params: { id: string }): Promise<ToolResult>;
}
