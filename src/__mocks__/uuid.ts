// Manual mock for uuid (ESM-only in v13) — redirected via moduleNameMapper in package.json
import { randomUUID } from 'crypto';
export const v4 = (): string => randomUUID();
