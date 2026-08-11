/** Darkwind.IDE.Open inbound payload (docs/gmcp-darkwind-ide.md:35-51). */
export interface DarkwindIdeOpen {
  path: string;
  content: string;
  language?: string;
  readOnly?: boolean;
  [key: string]: unknown;
}

/** Darkwind.IDE.OpenStart inbound payload (docs/gmcp-darkwind-ide.md:63-74). */
export interface DarkwindIdeOpenStart {
  /** IDE chunked-transfer id; unrelated to client/model/ids SessionId. */
  session: string;
  path: string;
  content: string;
  language?: string;
  readOnly?: boolean;
  chunks: number;
  totalLength: number;
  hash?: string;
  [key: string]: unknown;
}

/** Darkwind.IDE.OpenChunk inbound payload (docs/gmcp-darkwind-ide.md:78-84). */
export interface DarkwindIdeOpenChunk {
  /** IDE chunked-transfer id; unrelated to client/model/ids SessionId. */
  session: string;
  index: number;
  content: string;
  [key: string]: unknown;
}

/** Darkwind.IDE.OpenFinish inbound payload (docs/gmcp-darkwind-ide.md:88-91). */
export interface DarkwindIdeOpenFinish {
  /** IDE chunked-transfer id; unrelated to client/model/ids SessionId. */
  session: string;
  [key: string]: unknown;
}

/** Darkwind.IDE.SaveResult inbound payload (docs/gmcp-darkwind-ide.md:174-195). */
export interface DarkwindIdeSaveResult {
  path?: string;
  success: boolean;
  message?: string;
  errors?: Array<{
    line: number;
    column?: number;
    message: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Darkwind.IDE.Save outbound payload (docs/gmcp-darkwind-ide.md:102-114). */
export interface DarkwindIdeSave {
  path: string;
  content: string;
  [key: string]: unknown;
}

/** Darkwind.IDE.SaveStart outbound payload (docs/gmcp-darkwind-ide.md:126-134). */
export interface DarkwindIdeSaveStart {
  /** IDE chunked-transfer id; unrelated to client/model/ids SessionId. */
  session: string;
  path: string;
  chunks: number;
  totalLength: number;
  hash?: string;
  [key: string]: unknown;
}

/** Darkwind.IDE.SaveChunk outbound payload (docs/gmcp-darkwind-ide.md:138-144). */
export interface DarkwindIdeSaveChunk {
  /** IDE chunked-transfer id; unrelated to client/model/ids SessionId. */
  session: string;
  index: number;
  content: string;
  [key: string]: unknown;
}

/** Darkwind.IDE.SaveFinish outbound payload (docs/gmcp-darkwind-ide.md:148-151). */
export interface DarkwindIdeSaveFinish {
  /** IDE chunked-transfer id; unrelated to client/model/ids SessionId. */
  session: string;
  [key: string]: unknown;
}

/** Darkwind.IDE.SaveAbort outbound payload (docs/gmcp-darkwind-ide.md:156-160). */
export interface DarkwindIdeSaveAbort {
  /** IDE chunked-transfer id; unrelated to client/model/ids SessionId. */
  session: string;
  reason?: string;
  [key: string]: unknown;
}

/** Darkwind.IDE.Close outbound payload (docs/gmcp-darkwind-ide.md:210-220). */
export interface DarkwindIdeClose {
  path: string;
  [key: string]: unknown;
}
