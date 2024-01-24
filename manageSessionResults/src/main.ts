import { Client, Account, Databases, Query, ID, Permission, Role } from 'node-appwrite';

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

      if (req.method === 'PUT') {        
        log(`create`);
        const programId = jsonPayload.programId;
        if(!programId)throw new Error("No programId in request body");
        const sessionId = jsonPayload.sessionId;
        if(!sessionId)throw new Error("No sessionId in request body");
        const sessionResult = await db.createDocument(
              process.env.APPWRITE_DATABASE_ID!,
              "session_result",
              ID.unique(),
              {
                "user_key": userId,
                "session_key": sessionId,
                "session": [sessionId],
                "profile": [userId],
                "program_key": programId,
                "start_time_ms": Date.now(),
              },
              [
                Permission.read(Role.users()),        
                Permission.update(Role.team("admin")),
                Permission.delete(Role.team("admin")),
                Permission.delete(Role.user(userId)),
                Permission.update(Role.user(userId)),            
            ]
          );
          log("sessionResult: " + sessionResult);
          return res.send(sessionResult.$id);
      }
      if (req.method === 'POST') {
        const sessionResultId = jsonPayload.sessionResultId;
        if(!sessionResultId)throw new Error("No sessionResultId in request body");
        const document = await db.getDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "session_result",
          sessionResultId,
          [
            Query.equal("$id",userId)
          ]
        );
        if(!document){
          throw Error("No session result found");
        }
        log(`update`);
        const sessionResult = await db.updateDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "session_result",
          sessionResultId,
          {
            "end_time_ms": Date.now(),           
          }        
        );
        return res.send(sessionResult.$id);               
      }
      if (req.method === 'DELETE') {
        // TODO: ..
      }
      // `res.json()` is a handy helper for sending JSON
      // return res.json({
      //   motto: 'Build like a team of hundreds_',
      //   learn: 'https://appwrite.io/docs',
      //   connect: 'https://appwrite.io/discord',
      //   getInspired: 'https://builtwith.appwrite.io',
      // });
  }catch(e:any) {
    error(e);
    throw e;
  }
};
