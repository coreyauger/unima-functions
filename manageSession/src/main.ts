import { Client, Account, Databases, Permission, ID, Role } from 'node-appwrite';
import { connect } from 'getstream';

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
    'STREAM_API_KEY',
    'STREAM_API_SECRET',
    'STREAM_APP_ID',
  ]);
    try{
       // The `req` object contains the request data
       if (req.method === 'GET') {
        // Send a response with the res object helpers
        // `res.send()` dispatches a string back to the client
        return res.error('expected POST, DELETE');
      }
      log(req.body);
      const jsonPayload = JSON.parse(req.body);
      const jwtToken = jsonPayload.jwtToken;      
      if(!jwtToken)throw new Error("No JWT token in request body");
      const update = jsonPayload.session;             
      
      const userClient = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
        .setJWT(jwtToken);

      const userAccount = new Account(userClient);

      const userId = (await userAccount.get()).$id;
      if(!userId)throw new Error("No user found from JWT token");
      log(`got userId: ${userId}`);

      const client = new Client()
          .setEndpoint('https://cloud.appwrite.io/v1')
          .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
          .setKey(process.env.APPWRITE_API_KEY!);

      const db = new Databases(client);
      const program = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "program",
        update.program
        ).catch((r) => undefined);
      if(!program?.$id)throw new Error("Could not find prorgram for session with id: " + update.program);
      const instructor = (program as any).instructor.profile as [];
      if(!instructor.find( (p: any) => p.$id === userId))throw new Error(`User: ${userId} is not an instructor for this program`);

      const session = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "session",
        update.$id
        ).catch((r) => undefined);

      if(session?.$id){
        log("Found session, checking if ok to update: " + program?.$id);
        const doc = await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
          "session",
          session?.$id, {
            ...update,
            profile: userId, // Don't allow a profile id change
          });                  
          return res.json(doc);               
      } else {        
        const sessionId = ID.unique();
        log("Create a new session with data: " + JSON.stringify(update));       
        const created = await db.createDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "session",
          sessionId,
          {
            ...update,
            profile: userId, // Don't allow a profile id change
          },
          [
            Permission.read(Role.users()),        
            Permission.update(Role.team("admin")),
            Permission.delete(Role.team("admin")),
            Permission.update(Role.user(userId)),            
        ]);
        log(`session: ${JSON.stringify(created)}`);       
        return res.json(created);
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
