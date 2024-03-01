
export function throwIfMissing(obj: any, keys: string[]): void {
    const missing: string[] = [];
    for (let key of keys) {
      if (!(key in obj) || !obj[key]) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(", ")}`);
    }
  }
  
export type Context = {
    req: any;
    res: any;
    log: (msg: any) => void;
    error: (msg: any) => void;
  };
  