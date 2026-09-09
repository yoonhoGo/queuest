import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

export const DEFAULT_KEYCHAIN_SECURITY_PATH = "/usr/bin/security";
export const DEFAULT_KEYCHAIN_NAMESPACE = "com.yoonhogo.queuest.credentials";

export interface CredentialReference {
  pluginId: string;
  name: string;
}

export interface CredentialStore {
  set(pluginId: string, name: string, value: string): Promise<void>;
  set(reference: CredentialReference, value: string): Promise<void>;
  get(pluginId: string, name: string): Promise<string>;
  get(reference: CredentialReference): Promise<string>;
  delete(pluginId: string, name: string): Promise<void>;
  delete(reference: CredentialReference): Promise<void>;
}

export interface CredentialCommandResult {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export type CredentialExecFile = (
  file: string,
  args: readonly string[],
) => Promise<CredentialCommandResult>;

export interface KeychainCredentialIdentifiers {
  service: string;
  account: string;
}

export interface KeychainIdentifierOptions {
  namespace?: string;
  servicePrefix?: string;
  accountPrefix?: string;
}

export interface MacOSKeychainCredentialStoreOptions extends KeychainIdentifierOptions {
  execFile?: CredentialExecFile;
  commandExecutor?: CredentialExecFile;
  securityPath?: string;
  keychainPath?: string;
}

export type KeychainCredentialStoreOptions = MacOSKeychainCredentialStoreOptions;

export class CredentialStoreError extends Error {
  public readonly code: "CREDENTIAL_NOT_FOUND" | "KEYCHAIN_COMMAND_FAILED" | "INVALID_CREDENTIAL_REFERENCE";
  public readonly pluginId?: string;
  public readonly credentialName?: string;

  public constructor(
    code: CredentialStoreError["code"],
    message: string,
    reference?: CredentialReference,
  ) {
    super(message);
    this.code = code;
    this.pluginId = reference?.pluginId;
    this.credentialName = reference?.name;
    this.name = "CredentialStoreError";
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  public constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value);
    }
  }

  public async set(pluginId: string, name: string, value: string): Promise<void>;
  public async set(reference: CredentialReference, value: string): Promise<void>;
  public async set(
    pluginIdOrReference: string | CredentialReference,
    nameOrValue: string,
    maybeValue?: string,
  ): Promise<void> {
    const { reference, value } = parseSetArguments(pluginIdOrReference, nameOrValue, maybeValue);
    this.values.set(referenceKey(reference), value);
  }

  public async get(pluginId: string, name: string): Promise<string>;
  public async get(reference: CredentialReference): Promise<string>;
  public async get(
    pluginIdOrReference: string | CredentialReference,
    maybeName?: string,
  ): Promise<string> {
    const reference = parseReference(pluginIdOrReference, maybeName);
    const value = this.values.get(referenceKey(reference));
    if (value === undefined) {
      throw missingCredential(reference);
    }
    return value;
  }

  public async delete(pluginId: string, name: string): Promise<void>;
  public async delete(reference: CredentialReference): Promise<void>;
  public async delete(
    pluginIdOrReference: string | CredentialReference,
    maybeName?: string,
  ): Promise<void> {
    const reference = parseReference(pluginIdOrReference, maybeName);
    if (!this.values.delete(referenceKey(reference))) {
      throw missingCredential(reference);
    }
  }

  public async setCredential(pluginId: string, name: string, value: string): Promise<void> {
    return this.set(pluginId, name, value);
  }

  public async getCredential(pluginId: string, name: string): Promise<string> {
    return this.get(pluginId, name);
  }

  public async deleteCredential(pluginId: string, name: string): Promise<void> {
    return this.delete(pluginId, name);
  }
}

export class MacOSKeychainCredentialStore implements CredentialStore {
  private readonly executeFile: CredentialExecFile;
  private readonly securityPath: string;
  private readonly keychainPath?: string;
  private readonly identifierOptions: KeychainIdentifierOptions;

  public constructor(
    options: MacOSKeychainCredentialStoreOptions | CredentialExecFile = {},
  ) {
    const resolvedOptions = typeof options === "function" ? { execFile: options } : options;
    this.executeFile = resolvedOptions.execFile ?? resolvedOptions.commandExecutor ?? defaultCredentialExecFile;
    this.securityPath = resolvedOptions.securityPath ?? DEFAULT_KEYCHAIN_SECURITY_PATH;
    this.keychainPath = resolvedOptions.keychainPath;
    this.identifierOptions = {
      ...(resolvedOptions.namespace === undefined ? {} : { namespace: resolvedOptions.namespace }),
      ...(resolvedOptions.servicePrefix === undefined ? {} : { servicePrefix: resolvedOptions.servicePrefix }),
      ...(resolvedOptions.accountPrefix === undefined ? {} : { accountPrefix: resolvedOptions.accountPrefix }),
    };
  }

  public async set(pluginId: string, name: string, value: string): Promise<void>;
  public async set(reference: CredentialReference, value: string): Promise<void>;
  public async set(
    pluginIdOrReference: string | CredentialReference,
    nameOrValue: string,
    maybeValue?: string,
  ): Promise<void> {
    const { reference, value } = parseSetArguments(pluginIdOrReference, nameOrValue, maybeValue);
    const identifiers = createKeychainCredentialIdentifiers(reference, this.identifierOptions);
    await this.runSecurity(
      "add-generic-password",
      ["-a", identifiers.account, "-s", identifiers.service, "-w", value, "-U"],
      reference,
    );
  }

  public async get(pluginId: string, name: string): Promise<string>;
  public async get(reference: CredentialReference): Promise<string>;
  public async get(
    pluginIdOrReference: string | CredentialReference,
    maybeName?: string,
  ): Promise<string> {
    const reference = parseReference(pluginIdOrReference, maybeName);
    const identifiers = createKeychainCredentialIdentifiers(reference, this.identifierOptions);
    const result = await this.runSecurity(
      "find-generic-password",
      ["-a", identifiers.account, "-s", identifiers.service, "-w"],
      reference,
    );
    return removeSecurityOutputTerminator(result.stdout);
  }

  public async delete(pluginId: string, name: string): Promise<void>;
  public async delete(reference: CredentialReference): Promise<void>;
  public async delete(
    pluginIdOrReference: string | CredentialReference,
    maybeName?: string,
  ): Promise<void> {
    const reference = parseReference(pluginIdOrReference, maybeName);
    const identifiers = createKeychainCredentialIdentifiers(reference, this.identifierOptions);
    await this.runSecurity(
      "delete-generic-password",
      ["-a", identifiers.account, "-s", identifiers.service],
      reference,
    );
  }

  public async setCredential(pluginId: string, name: string, value: string): Promise<void> {
    return this.set(pluginId, name, value);
  }

  public async getCredential(pluginId: string, name: string): Promise<string> {
    return this.get(pluginId, name);
  }

  public async deleteCredential(pluginId: string, name: string): Promise<void> {
    return this.delete(pluginId, name);
  }

  private async runSecurity(
    command: string,
    args: readonly string[],
    reference: CredentialReference,
  ): Promise<CredentialCommandResult> {
    const commandArgs = this.keychainPath === undefined
      ? [command, ...args]
      : [command, "-k", this.keychainPath, ...args];
    try {
      return await this.executeFile(this.securityPath, commandArgs);
    } catch (error: unknown) {
      if (isMissingCredentialError(error)) {
        throw missingCredential(reference);
      }
      // Do not retain the original error: child-process errors can include
      // command arguments, stderr, or a secret passed to `-w`.
      throw new CredentialStoreError(
        "KEYCHAIN_COMMAND_FAILED",
        `Keychain ${command} failed for the requested credential`,
        reference,
      );
    }
  }
}

export const MacOSKeyChainCredentialStore = MacOSKeychainCredentialStore;
export const MacOSKeychainStore = MacOSKeychainCredentialStore;

export function createKeychainCredentialIdentifiers(
  reference: CredentialReference,
  options: KeychainIdentifierOptions = {},
): KeychainCredentialIdentifiers {
  const normalized = parseReference(reference);
  const namespace = normalizeNamespace(
    options.namespace ?? options.servicePrefix ?? DEFAULT_KEYCHAIN_NAMESPACE,
  );
  const servicePrefix = normalizeNamespace(options.servicePrefix ?? namespace);
  const accountPrefix = normalizeNamespace(options.accountPrefix ?? namespace);
  return {
    service: `${servicePrefix}.plugin.${normalized.pluginId}`,
    account: `${accountPrefix}.plugin.${normalized.pluginId}.${normalized.name}`,
  };
}

export const keychainCredentialIdentifiers = createKeychainCredentialIdentifiers;

const defaultCredentialExecFile: CredentialExecFile = async (file, args) => {
  const execFileAsync = promisify(nodeExecFile);
  const result = await execFileAsync(file, [...args], { encoding: "utf8" });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

function parseSetArguments(
  pluginIdOrReference: string | CredentialReference,
  nameOrValue: string,
  maybeValue?: string,
): { reference: CredentialReference; value: string } {
  if (typeof pluginIdOrReference === "string") {
    if (maybeValue === undefined) {
      throw invalidReference();
    }
    return {
      reference: parseReference(pluginIdOrReference, nameOrValue),
      value: maybeValue,
    };
  }
  return {
    reference: parseReference(pluginIdOrReference),
    value: nameOrValue,
  };
}

function parseReference(
  pluginIdOrReference: string | CredentialReference,
  maybeName?: string,
): CredentialReference {
  const pluginId = typeof pluginIdOrReference === "string"
    ? pluginIdOrReference
    : pluginIdOrReference.pluginId;
  const name = typeof pluginIdOrReference === "string"
    ? maybeName
    : pluginIdOrReference.name;
  if (typeof pluginId !== "string" || pluginId.trim().length === 0 || typeof name !== "string" || name.trim().length === 0) {
    throw invalidReference();
  }
  return { pluginId: pluginId.trim(), name: name.trim() };
}

function referenceKey(reference: CredentialReference): string {
  return `${reference.pluginId}\u0000${reference.name}`;
}

function createCredentialError(
  code: CredentialStoreError["code"],
  message: string,
  reference?: CredentialReference,
): CredentialStoreError {
  return new CredentialStoreError(code, message, reference);
}

function invalidReference(): CredentialStoreError {
  return createCredentialError(
    "INVALID_CREDENTIAL_REFERENCE",
    "credential plugin id and name must not be empty",
  );
}

function missingCredential(reference: CredentialReference): CredentialStoreError {
  return createCredentialError(
    "CREDENTIAL_NOT_FOUND",
    `credential ${reference.name} was not found for plugin ${reference.pluginId}`,
    reference,
  );
}

function normalizeNamespace(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError("Keychain namespace must not be empty");
  }
  return normalized;
}

function removeSecurityOutputTerminator(value: string | Buffer | undefined): string {
  const text = value === undefined ? "" : toText(value);
  return text.endsWith("\n")
    ? text.slice(0, -1).endsWith("\r")
      ? text.slice(0, -2)
      : text.slice(0, -1)
    : text;
}

function toText(value: string | Buffer): string {
  return typeof value === "string" ? value : value.toString("utf8");
}

function isMissingCredentialError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const code = error.code;
  if (code === 44 || code === "44") {
    return true;
  }
  const status = error.status;
  if (status === 44 || status === "44") {
    return true;
  }
  const diagnostic = [error.message, error.stderr, error.stdout]
    .filter((value) => typeof value === "string" || Buffer.isBuffer(value))
    .map((value) => toText(value as string | Buffer).toLowerCase())
    .join(" ");
  return diagnostic.includes("could not be found") || diagnostic.includes("item not found");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
