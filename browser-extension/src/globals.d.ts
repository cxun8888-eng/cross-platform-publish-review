declare const chrome: {
  runtime: {
    onMessage: { addListener: (listener: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean | void) => void };
    sendMessage: (message: unknown, callback?: (response: any) => void) => Promise<any>;
    lastError?: { message?: string };
  };
  tabs: {
    create: (createProperties: { url: string }) => Promise<unknown>;
    update: (tabId: number, updateProperties: { url: string }) => Promise<unknown>;
    onUpdated: { addListener: (listener: (tabId: number, changeInfo: { url?: string }) => void) => void };
    onRemoved: { addListener: (listener: (tabId: number) => void) => void };
  };
  debugger: {
    attach: (target: { tabId: number }, requiredVersion: string) => Promise<void>;
    sendCommand: (target: { tabId: number }, method: string, commandParams?: Record<string, unknown>) => Promise<unknown>;
    detach: (target: { tabId: number }) => Promise<void>;
  };
  permissions: {
    contains: (permissions: { permissions: string[] }) => Promise<boolean>;
  };
  storage: {
    local: { get: (keys?: string | string[] | Record<string, unknown>) => Promise<Record<string, any>>; set: (items: Record<string, unknown>) => Promise<void> };
    session: { get: (keys?: string | string[] | Record<string, unknown>) => Promise<Record<string, any>>; set: (items: Record<string, unknown>) => Promise<void>; remove: (keys: string | string[]) => Promise<void> };
  };
};
