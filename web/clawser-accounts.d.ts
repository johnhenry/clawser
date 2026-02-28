import type { ProviderConfig } from './types.d.ts';

export interface ServiceDef {
  name: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
}

export interface Account {
  id: string;
  name: string;
  service: string;
  apiKey: string;
  model: string;
}

export const SERVICES: Readonly<Record<string, ServiceDef>>;
export const ACCT_KEY: string;

export function loadAccounts(): Account[];
export function saveAccounts(list: Account[]): void;
export function createAccount(opts: { name: string; service: string; apiKey: string; model: string }): Promise<string>;
export function updateAccount(id: string, updates: Partial<Account>): void;
export function deleteAccount(id: string): void;
export function storeAccountKey(acctId: string, apiKey: string): Promise<void>;
export function resolveAccountKey(acct: Account): Promise<string>;
export function migrateKeysToVault(): Promise<number>;
export function renderAccountList(): void;
export function showAccountEditForm(acct: Account, parentEl: HTMLElement): void;
export function onProviderChange(): Promise<void>;
export function saveConfig(): void;
export function applyRestoredConfig(savedConfig: Record<string, unknown>): Promise<void>;
export function rebuildProviderDropdown(): Promise<void>;
export function setupProviders(): Promise<void>;
export function initAccountListeners(): void;
