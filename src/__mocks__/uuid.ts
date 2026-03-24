// Manual mock for uuid to work around ESM-only uuid v13 in Jest/CJS environment
const { randomUUID } = require('crypto');

export const v4 = (): string => randomUUID();
