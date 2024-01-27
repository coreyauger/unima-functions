import { Client, Account, Databases, Query, Permission, Role } from 'node-appwrite';
import { createHash } from 'node:crypto';

function sha256(content: string) {  
  return createHash('sha256').update(content).digest('hex')
}

function throwIfMissing(obj: any, keys: string[]): void {
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

type Context = {
  req: any;
  res: any;
  log: (msg: any) => void;
  error: (msg: any) => void;
};

// This is your Appwrite function
// It's executed each time we get a request
export default async ({ req, res, log, error }: Context) => {
  throwIfMissing(process.env, [
    'APPWRITE_API_KEY',
    'APPWRITE_FUNCTION_PROJECT_ID',
    'APPWRITE_DATABASE_ID',
    'BUNNY_API_KEY'
  ]);
    try{
       // The `req` object contains the request data
       if (req.method !== 'GET') {
        // Send a response with the res object helpers
        // `res.send()` dispatches a string back to the client
        return res.error('expected GET method');
      }
      log(req.body);
      const jsonPayload = JSON.parse(req.body);
      const jwtToken = jsonPayload.jwtToken;
      if(!jwtToken)throw new Error("No JWT token in request body");          
      
      const userClient = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
        .setJWT(jwtToken);

      const userAccount = new Account(userClient);

      const videoId = jsonPayload.videoId;
      if(!videoId)throw new Error("No video ID was in the request body.");   

      // UNIX timestamp when the vidoe link will expire (default to 120 minutes)
      const timestamp = Math.round( (Date.now() + (120 * 60 * 1000)) / 1000 );  // UNIX POSIX is in seconds not ms.
      const hash = sha256(process.env.BUNNY_API_KEY! + videoId + timestamp);
      return res.json({
        hash,
        timestamp,
      });
  }catch(e:any) {
    error(e);
    throw e;
  }
};
