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
      const update = jsonPayload.series;             
      
      const userClient = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
        .setJWT(jwtToken);

      const userAccount = new Account(userClient);

      const userId = (await userAccount.get()).$id;
      if(!userId)throw new Error("No user found from JWT token");
      log(`got userId: ${userId}`);

      const programKey = jsonPayload.programKey;      
      if(!jwtToken)throw new Error("No programKey in request body");

      const client = new Client()
          .setEndpoint('https://cloud.appwrite.io/v1')
          .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
          .setKey(process.env.APPWRITE_API_KEY!);

      const db = new Databases(client);
      const program = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "program",
        programKey
        ).catch((r) => undefined);
      if(!program?.$id)throw new Error("Could not find prorgram for series with id: " + update.programKey);
      const instructor = (program as any).instructor.profile as [];
      if(!instructor.find( (p: any) => p.$id === userId))throw new Error(`User: ${userId} is not an instructor for this program`);

      const series = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "series",
        update.$id
        ).catch((r) => undefined);

      if(series?.$id){
        log("Found series, checking if ok to update: " + series?.$id);
        const doc = await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
          "series",
          series?.$id, {
            ...update,
            program: program.$id,    
          });                  
          return res.json(doc);               
      } else {        
        const seriesId = ID.unique();
        log("Create a new series with data: " + JSON.stringify(update));       
        const created = await db.createDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "series",
          seriesId,
          {
            ...update,
            program: program.$id,          
          },
          [
            Permission.read(Role.users()),        
            Permission.update(Role.team("admin")),
            Permission.delete(Role.team("admin")),
            Permission.update(Role.user(userId)),            
        ]);      
        log(`series: ${JSON.stringify(created)}`);       
        return res.json(created);
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
