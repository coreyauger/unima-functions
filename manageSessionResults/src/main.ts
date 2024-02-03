import { Client, Account, Databases, Query, ID, Permission, Role } from 'node-appwrite';
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
                "session": sessionId,
                "profile": userId,
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
          log("sessionResult: " + JSON.stringify(sessionResult));
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
        // get the session..
        const session = await db.getDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "session",
          (sessionResult as any).session_id      
        );
        
        // - Also post the result to the sessions timeline
        const client = connect(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!, process.env.STREAM_APP_ID!);
        const sessionFeed = client.feed('session_activity', sessionResultId);
        // Create an activity object
        const activity = { actor: `User:${userId}`, verb: 'finished', object: `SessionResult:${(sessionResult as any).session_key}`, foreign_id:(sessionResult as any).session_key, sessionResult, session };
        // Add an activity to the feed
        await sessionFeed.addActivity(activity);

        // - Post the result to the users feed
        const userFeed = client.feed('user', userId);
        await userFeed.addActivity(activity);

        return res.send(sessionResult.$id);               
      }
      if (req.method === 'DELETE') {
        // TODO: ..
      }    
  }catch(e:any) {
    error(e);
    throw e;
  }
};
